import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

const databasePath = join("/private/tmp", `curioflow-mobile-workflows-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
process.env.DATABASE_URL = databaseUrl;

execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "inherit"
});

const { Prisma, PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

try {
  const account = await prisma.account.create({ data: { name: "Workflow A" } });
  const otherAccount = await prisma.account.create({ data: { name: "Workflow B" } });
  const user = await prisma.user.create({ data: { accountId: account.id, displayName: "Workflow User" } });
  const library = await prisma.library.create({ data: { accountId: account.id, name: "Workflow Library" } });
  const sourceA = await prisma.source.create({ data: { libraryId: library.id, type: "rss", name: "Feed A" } });
  const sourceB = await prisma.source.create({ data: { libraryId: library.id, type: "rss", name: "Feed B" } });

  const baseline = (await prisma.libraryChange.aggregate({
    where: { libraryId: library.id },
    _max: { revision: true }
  }))._max.revision ?? 0n;

  await prisma.item.createMany({
    data: Array.from({ length: 300 }, (_, index) => ({
      id: `page-item-${index}`,
      libraryId: library.id,
      type: "article",
      title: `Page item ${index}`
    }))
  });
  const watermark = (await prisma.libraryChange.aggregate({
    where: { libraryId: library.id },
    _max: { revision: true }
  }))._max.revision ?? 0n;

  await prisma.item.create({
    data: { id: "concurrent-item", libraryId: library.id, type: "article", title: "Concurrent" }
  });

  let cursor = baseline;
  const delivered = [];
  while (true) {
    const page = await prisma.libraryChange.findMany({
      where: { libraryId: library.id, revision: { gt: cursor, lte: watermark } },
      orderBy: { revision: "asc" },
      take: 100
    });
    if (page.length === 0) break;
    delivered.push(...page);
    cursor = page.at(-1).revision;
  }
  assert.equal(delivered.length, 300);
  assert.equal(new Set(delivered.map((change) => change.entityId)).size, 300);
  assert.equal(delivered.some((change) => change.entityId === "concurrent-item"), false);
  const nextCycle = await prisma.libraryChange.findMany({
    where: { libraryId: library.id, revision: { gt: watermark } }
  });
  assert.equal(nextCycle.some((change) => change.entityId === "concurrent-item"), true);

  const content = await prisma.contentObject.create({
    data: { canonicalKey: "workflow-article", type: "article", status: "ready" }
  });
  const document = await prisma.document.create({
    data: {
      contentObjectId: content.id,
      contentType: "article",
      text: "Workflow text",
      contentHash: "workflow-hash",
      parserVersion: "workflow-test"
    }
  });
  const item = await prisma.item.create({
    data: {
      id: "nested-item",
      libraryId: library.id,
      sourceId: sourceA.id,
      contentObjectId: content.id,
      documentId: document.id,
      type: "article",
      title: "Nested item",
      status: "ready"
    }
  });
  const nestedBaseline = (await prisma.libraryChange.aggregate({
    where: { libraryId: library.id },
    _max: { revision: true }
  }))._max.revision ?? 0n;
  const annotation = await prisma.annotation.create({
    data: {
      id: "annotation-workflow",
      userId: user.id,
      itemId: item.id,
      documentId: document.id,
      quote: "Workflow",
      locationJson: "{}"
    }
  });
  await prisma.annotation.update({ where: { id: annotation.id }, data: { note: "Updated" } });
  await prisma.annotation.delete({ where: { id: annotation.id } });
  await prisma.document.update({ where: { id: document.id }, data: { metadataJson: "{\"summaryStatus\":\"succeeded\"}" } });
  const nestedChanges = await prisma.libraryChange.findMany({
    where: { libraryId: library.id, revision: { gt: nestedBaseline }, entityType: "item", entityId: item.id }
  });
  assert.equal(nestedChanges.length >= 4, true);

  await prisma.sourceEntry.createMany({
    data: [
      { libraryId: library.id, sourceId: sourceA.id, itemId: item.id, entryKey: "feed-a" },
      { libraryId: library.id, sourceId: sourceB.id, itemId: item.id, entryKey: "feed-b" }
    ]
  });
  assert.equal(await prisma.item.count({ where: { id: item.id, sourceEntries: { some: { sourceId: sourceB.id } } } }), 1);
  await prisma.sourceEntry.deleteMany({ where: { sourceId: sourceA.id } });
  assert.equal(await prisma.item.count({ where: { id: item.id } }), 1);

  const receipt = {
    libraryId: library.id,
    deviceId: "workflow-device",
    clientMutationId: "workflow-mutation",
    itemId: item.id,
    responseJson: "{\"ok\":true}"
  };
  await prisma.mobileMutationReceipt.create({ data: receipt });
  await assert.rejects(
    prisma.mobileMutationReceipt.create({ data: receipt }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );

  const privateContent = await prisma.contentObject.create({
    data: {
      canonicalKey: "private-workflow",
      type: "pdf",
      cacheScope: "account_private",
      ownerAccountId: account.id,
      fileSha256: "account-scoped-workflow"
    }
  });
  const privateDocument = await prisma.document.create({
    data: {
      contentObjectId: privateContent.id,
      ownerAccountId: account.id,
      contentType: "pdf_text",
      text: "Private",
      contentHash: "private-hash",
      parserVersion: "workflow-test"
    }
  });
  assert.equal(await prisma.document.count({
    where: { id: privateDocument.id, OR: [{ ownerAccountId: null }, { ownerAccountId: account.id }] }
  }), 1);
  assert.equal(await prisma.document.count({
    where: { id: privateDocument.id, OR: [{ ownerAccountId: null }, { ownerAccountId: otherAccount.id }] }
  }), 0);

  const podcastJob = await prisma.job.create({
    data: {
      libraryId: library.id,
      contentObjectId: privateContent.id,
      type: "transcribe_podcast",
      status: "queued"
    }
  });
  await assert.rejects(
    prisma.job.create({
      data: {
        libraryId: library.id,
        contentObjectId: privateContent.id,
        type: "transcribe_podcast",
        status: "running"
      }
    }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
  await prisma.job.update({ where: { id: podcastJob.id }, data: { status: "succeeded" } });

  const accountExport = await prisma.accountExport.create({
    data: {
      accountId: account.id,
      status: "ready",
      downloadTokenHash: "workflow-export-token",
      retainedUntil: new Date(Date.now() + 60_000)
    }
  });
  assert.equal(await prisma.accountExport.count({ where: { id: accountExport.id, accountId: account.id } }), 1);
  assert.equal(await prisma.accountExport.count({ where: { id: accountExport.id, accountId: otherAccount.id } }), 0);
  const activeAccountExport = await prisma.accountExport.create({ data: { accountId: account.id } });
  await assert.rejects(
    prisma.accountExport.create({ data: { accountId: account.id, status: "running" } }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
  await prisma.accountExport.update({ where: { id: activeAccountExport.id }, data: { status: "failed" } });
  await assert.rejects(
    prisma.accountExport.create({
      data: { accountId: otherAccount.id, downloadTokenHash: "workflow-export-token" }
    }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );

  const deleteBaseline = (await prisma.libraryChange.aggregate({
    where: { libraryId: library.id },
    _max: { revision: true }
  }))._max.revision ?? 0n;
  await prisma.item.delete({ where: { id: item.id } });
  const tombstone = await prisma.libraryChange.findFirst({
    where: {
      libraryId: library.id,
      revision: { gt: deleteBaseline },
      entityType: "item",
      entityId: item.id,
      operation: "delete"
    }
  });
  assert.ok(tombstone);

  console.log("mobile workflow integration passed");
} finally {
  await prisma.$disconnect();
  await unlink(databasePath).catch(() => undefined);
  await unlink(`${databasePath}-journal`).catch(() => undefined);
  await unlink(`${databasePath}-wal`).catch(() => undefined);
  await unlink(`${databasePath}-shm`).catch(() => undefined);
}
