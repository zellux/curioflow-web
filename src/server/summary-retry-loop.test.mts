import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Feed refreshes re-save every entry; a failed summary must not be re-enqueued on each refresh.
test("summary enqueue skips failed summaries only when asked", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-summary-retry-"));
  const env = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { enqueueArticleSummaryGeneration } = await import("./summaries.ts");
  try {
    const account = await prisma.account.create({ data: { name: "Summary retry test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "A" } });
    const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: "summary-retry" } });
    const document = await prisma.document.create({ data: {
      contentObjectId: content.id, ownerAccountId: account.id, contentType: "article", text: "Body", contentHash: "summary-retry-hash",
      parserVersion: "test", metadataJson: JSON.stringify({ summaryStatus: "failed", summaryAccountId: account.id })
    } });
    const item = await prisma.item.create({ data: {
      libraryId: library.id, type: "article", title: "Failed summary", status: "ready", contentObjectId: content.id, documentId: document.id
    } });
    const summaryJobs = () => prisma.job.count({ where: { libraryId: library.id, type: "generate_summary" } });

    assert.equal((await enqueueArticleSummaryGeneration({ libraryId: library.id, itemId: item.id, includeUnsaved: true, skipFailed: true })).status, "skipped");
    assert.equal(await summaryJobs(), 0);
    assert.equal((await enqueueArticleSummaryGeneration({ libraryId: library.id, itemId: item.id, includeUnsaved: true })).status, "queued");
    assert.equal(await summaryJobs(), 1);
  } finally {
    await prisma.$disconnect();
    process.env = env;
    rmSync(directory, { force: true, recursive: true });
  }
});
