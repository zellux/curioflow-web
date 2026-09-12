import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../src/server/db.ts";
import { getMobileSyncPayload } from "../src/server/mobile.ts";
import { startQueuedBackgroundJobs } from "../src/server/background-jobs.ts";
import { claimQueuedJob } from "../src/server/job-claim.ts";
import { askLibrary } from "../src/server/chat.ts";
import { savePdfToLibrary } from "../src/server/ingest/pdf.ts";
import { getInboxItems } from "../src/server/items.ts";

before(async () => {
  await prisma.account.create({ data: { id: "service-account", name: "Service tests" } });
  await prisma.user.create({ data: { id: "service-user", accountId: "service-account", displayName: "Test" } });
  await prisma.library.create({ data: { id: "service-library", accountId: "service-account", name: "Test" } });
  await prisma.llmSetting.create({ data: { accountId: "service-account", enabled: false, model: "test" } });
});
after(async () => { await prisma.$disconnect(); });

test("initial mobile sync delivers every item and catches changes during pagination", async () => {
  await prisma.item.createMany({ data: Array.from({ length: 300 }, (_, i) => ({
    id: `snapshot-${String(i).padStart(3, "0")}`, libraryId: "service-library", type: "article", title: `Article ${i}`
  })) });
  let page = await getMobileSyncPayload("http://localhost/api/mobile/v1/sync?scope=all&limit=150");
  const watermark = page.watermark;
  const delivered = new Set(page.items.map(item => item.id));
  assert.equal(page.hasMore, true);
  // Sorting by reading activity or applying an offset would skip rows here.
  await prisma.item.update({ where: { id: "snapshot-200" }, data: { lastReadAt: new Date() } });
  await prisma.item.create({ data: { id: "before-snapshot", libraryId: "service-library", type: "article", title: "Concurrent save" } });
  for (let count = 0; page.hasMore; count++) {
    assert.ok(count < 10, "snapshot pagination must terminate");
    assert.ok(page.nextPageCursor);
    page = await getMobileSyncPayload(`http://localhost/api/mobile/v1/sync?scope=all&limit=150&watermark=${watermark}&pageCursor=${encodeURIComponent(page.nextPageCursor)}`);
    assert.equal(page.watermark, watermark);
    for (const item of page.items) delivered.add(item.id);
  }
  assert.equal([...delivered].filter(id => id.startsWith("snapshot-")).length, 300);
  const delta = await getMobileSyncPayload(`http://localhost/api/mobile/v1/sync?scope=all&limit=150&cursor=${watermark}`);
  assert.ok(delta.items.some(item => item.id === "before-snapshot"));
  assert.ok(delta.items.some(item => item.id === "snapshot-200"));
  const defaultPage = await getMobileSyncPayload("http://localhost/api/mobile/v1/sync?scope=all");
  assert.equal(defaultPage.items.length, 100);
});

test("a web process cannot dispatch or claim queued work", async () => {
  const accountExport = await prisma.accountExport.create({ data: { accountId: "service-account" } });
  const job = await prisma.job.create({ data: {
    libraryId: "service-library", type: "export_account",
    payloadJson: JSON.stringify({ accountId: "service-account", exportId: accountExport.id })
  } });
  assert.deepEqual(await startQueuedBackgroundJobs({ libraryId: "service-library" }), { queued: 0, started: 0 });
  assert.equal(await claimQueuedJob(job), false);
  const unchanged = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(unchanged.status, "queued");
  assert.equal(unchanged.attempts, 0);
  await prisma.job.delete({ where: { id: job.id } });
  await prisma.accountExport.delete({ where: { id: accountExport.id } });
});

test("Ask Library searches beyond 120 documents without returning other accounts' evidence", async () => {
  for (let index = 0; index < 121; index++) {
    const text = `UniqueAuditNeedle${String(index).padStart(3, "0")} evidence`;
    const content = await prisma.contentObject.create({ data: { canonicalKey: `search-${index}`, type: "article" } });
    const document = await prisma.document.create({ data: {
      contentObjectId: content.id, contentType: "article", text, contentHash: String(index), parserVersion: "test",
      chunks: { create: { chunkIndex: 0, text, tokenCount: 5, contentHash: String(index) } }
    } });
    await prisma.item.create({ data: {
      id: `search-${index}`, libraryId: "service-library", contentObjectId: content.id,
      documentId: document.id, type: "article", title: `Indexed article ${index}`
    } });
  }
  await prisma.account.create({ data: { id: "other-account", name: "Other" } });
  const privateContent = await prisma.contentObject.create({ data: { canonicalKey: "private-search", type: "article" } });
  const privateDocument = await prisma.document.create({ data: {
    contentObjectId: privateContent.id, ownerAccountId: "other-account", contentType: "article",
    text: "UniqueAuditNeedle000 private", contentHash: "private", parserVersion: "test",
    chunks: { create: { chunkIndex: 0, text: "UniqueAuditNeedle000 private", tokenCount: 5, contentHash: "private" } }
  } });
  await prisma.item.create({ data: { libraryId: "service-library", documentId: privateDocument.id, type: "article", title: "Private" } });
  for (let index = 0; index < 121; index++) {
    const thread = await askLibrary(`uniqueauditneedle${String(index).padStart(3, "0")}`);
    const answer = thread?.messages.find(message => message.role === "assistant");
    assert.ok(answer);
    const evidence = JSON.parse(answer.citationsJson) as { citations: Array<{ itemId: string }> };
    assert.deepEqual(evidence.citations.map(citation => citation.itemId), [`search-${index}`]);
  }
});

test("PDF retries and concurrent uploads reuse one item and one parse job", async () => {
  const file = new File(["%PDF-1.4\n% test fixture"], "test.pdf", { type: "application/pdf" });
  const first = await savePdfToLibrary("service-library", file);
  const duplicate = await savePdfToLibrary("service-library", file);
  assert.equal(duplicate.id, first.id);
  await prisma.item.update({ where: { id: first.id }, data: { deletedAt: new Date(), archivedAt: new Date(), readingProgress: 0.5 } });
  const restored = await savePdfToLibrary("service-library", file);
  assert.equal(restored.id, first.id);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.readingProgress, 0.5);
  const simultaneous = await Promise.all(Array.from({ length: 3 }, () => savePdfToLibrary("service-library", file)));
  assert.ok(simultaneous.every(item => item.id === first.id));
  assert.equal(await prisma.job.count({ where: { libraryId: "service-library", contentObjectId: first.contentObjectId, type: "parse_pdf" } }), 1);
  assert.equal(await prisma.sourceEntry.count({ where: { itemId: first.id } }), 1);
  const newFile = new File(["%PDF-1.4\n% concurrent first upload"], "new.pdf", { type: "application/pdf" });
  const freshUploads = await Promise.all(Array.from({ length: 3 }, () => savePdfToLibrary("service-library", newFile)));
  assert.equal(new Set(freshUploads.map(item => item.id)).size, 1);
  assert.equal(await prisma.job.count({ where: { libraryId: "service-library", contentObjectId: freshUploads[0].contentObjectId, type: "parse_pdf" } }), 1);
});

test("database pagination preserves activity and feed order as dates change", async () => {
  const source = await prisma.source.create({ data: { libraryId: "service-library", type: "rss", name: "Pagination" } });
  const fixtures = [
    { id: "page-import", createdAt: new Date("2026-07-12"), lastReadAt: new Date("2026-07-11"), publishedAt: new Date("2026-06-01") },
    { id: "page-read", createdAt: new Date("2026-07-01"), lastReadAt: new Date("2026-07-13"), publishedAt: new Date("2026-07-01") },
    { id: "page-undated", createdAt: new Date("2026-06-15"), lastReadAt: null, publishedAt: null }
  ];
  for (const fixture of fixtures) {
    await prisma.item.create({ data: {
      ...fixture, libraryId: "service-library", sourceId: source.id, type: "article", title: "pagination-audit",
      sourceEntries: { create: { libraryId: "service-library", sourceId: source.id, entryKey: fixture.id } }
    } });
  }
  const first = await getInboxItems({ query: "pagination-audit" }, { pageSize: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.pageCount, 2);
  assert.deepEqual(first.items.map(item => item.id), ["page-read", "page-import"]);
  const last = await getInboxItems({ query: "pagination-audit" }, { pageSize: 2, page: 99 });
  assert.equal(last.page, 2);
  assert.deepEqual(last.items.map(item => item.id), ["page-undated"]);
  await prisma.item.update({ where: { id: "page-import" }, data: { lastReadAt: new Date("2026-07-14") } });
  assert.equal((await getInboxItems({ query: "pagination-audit" }, { pageSize: 1 })).items[0].id, "page-import");
  await prisma.item.updateMany({ where: { sourceId: source.id }, data: { savedToLibrary: false } });
  const feed = await getInboxItems({ sourceId: source.id }, { pageSize: 3 });
  assert.deepEqual(feed.items.map(item => item.id), ["page-read", "page-undated", "page-import"]);
  await prisma.item.update({ where: { id: "page-import" }, data: { publishedAt: new Date("2026-07-20") } });
  assert.equal((await getInboxItems({ sourceId: source.id }, { pageSize: 1 })).items[0].id, "page-import");
});


test("source inbox counts exclude saved, archived and deleted items and deduplicate shared entries", async () => {
  const { getLibrarySourcesForLibrary } = await import("../src/server/sources.ts");
  for (const id of ["count-source-a", "count-source-b"]) {
    await prisma.source.create({ data: { id, libraryId: "service-library", type: "rss", name: "Reader&#039;s feed" } });
  }
  for (const [suffix, state] of Object.entries({ pending: {}, saved: { savedToLibrary: true }, archived: { archivedAt: new Date() }, deleted: { deletedAt: new Date() } })) {
    const id = `count-${suffix}`;
    await prisma.item.create({ data: { id, libraryId: "service-library", type: "article", title: suffix, savedToLibrary: false, ...state } });
    for (const sourceId of ["count-source-a", "count-source-b"]) {
      await prisma.sourceEntry.create({ data: { libraryId: "service-library", sourceId, itemId: id, entryKey: id } });
    }
  }
  const sources = await getLibrarySourcesForLibrary("service-library");
  const a = sources.find(source => source.id === "count-source-a")!;
  assert.equal(a.pendingCount, 1);
  assert.equal(a._count.items, 3);
  assert.equal(a.name, "Reader's feed");
  const page = await getInboxItems({ sourceType: "rss" });
  assert.equal(a.streamCount, page.total);
});

test("RSS next article crosses pagination boundaries without selecting saved or archived entries", async () => {
  const { getNextRssItem } = await import("../src/server/reader-next.ts");
  const sourceId = "next-feed";
  await prisma.source.create({ data: { id: sourceId, libraryId: "service-library", type: "rss", name: "Next feed" } });
  for (let i = 0; i < 24; i++) {
    const id = `next-${String(i).padStart(2, "0")}`;
    await prisma.item.create({ data: { id, libraryId: "service-library", type: "article", title: id, savedToLibrary: i === 20, archivedAt: i === 21 ? new Date() : null, publishedAt: new Date(Date.UTC(2026, 0, 24 - i)), sourceEntries: { create: { libraryId: "service-library", sourceId, entryKey: id } } } });
  }
  const page = await getInboxItems({ sourceId });
  const current = page.items.at(-1)!;
  assert.equal(current.id, "next-19");
  assert.equal((await getNextRssItem(current, { source: sourceId }))?.id, "next-22");
  assert.equal(await getNextRssItem(current, { filter: "archive" }), null);
});
