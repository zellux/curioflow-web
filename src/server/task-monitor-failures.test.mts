import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("failure categories retry the entire selected category once and stay inside the current library", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-failures-"));
  const previous = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { getTaskMonitor, retryMonitoredFailures, retryMonitoredJob } = await import("./task-monitor.ts");
  try {
    const account = await prisma.account.create({ data: { name: "Failures" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Current" } });
    const other = await prisma.library.create({ data: { account: { create: { name: "Other account" } }, name: "Other" } });
    const old = new Date(Date.now() - 3 * 86400000);
    await prisma.item.createMany({ data: Array.from({ length: 102 }, (_, i) => ({
      id: `fetch-${i}`, libraryId: library.id, type: "article", title: `Fetch ${i}`, status: "failed"
    })) });
    await prisma.job.createMany({ data: Array.from({ length: 102 }, (_, i) => ({
      id: `fetch-job-${i}`, libraryId: library.id, type: i % 2 ? "refetch_article" : "ingest_url", status: "failed",
      attempts: 3, error: "secret-fetch-error", createdAt: old, finishedAt: old,
      payloadJson: JSON.stringify({ itemId: `fetch-${i}` }), progressJson: '{"failureCategory":"network"}'
    })) });
    const missingFetch = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "No retry job", status: "failed" } });
    const activeFetch = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Already fetching", status: "failed" } });
    const activeFetchFailure = await prisma.job.create({ data: { libraryId: library.id, type: "ingest_url", status: "failed", payloadJson: JSON.stringify({ itemId: activeFetch.id }) } });
    await prisma.job.create({ data: { libraryId: library.id, type: "refetch_article", status: "running", payloadJson: JSON.stringify({ itemId: activeFetch.id }) } });

    const summaries = [];
    for (let i = 0; i < 3; i++) {
      const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: `summary-${i}` } });
      const document = await prisma.document.create({ data: { contentObjectId: content.id, contentType: "article", text: "Article text", contentHash: `hash-${i}`, parserVersion: "test", metadataJson: '{"summaryStatus":"failed"}' } });
      summaries.push(await prisma.item.create({ data: {
        libraryId: library.id, type: "article", title: `Summary ${i}`, status: "ready", updatedAt: old,
        contentObjectId: content.id, documentId: document.id
      } }));
    }
    const summaryJobData = { libraryId: library.id, type: "generate_summary", status: "failed", attempts: 3,
      error: "secret-summary-error", progressJson: '{"failureCategory":"network"}', payloadJson: JSON.stringify({ itemId: summaries[0].id }) };
    const obsoleteSummary = await prisma.job.create({ data: { ...summaryJobData, finishedAt: old } });
    const summaryJob = await prisma.job.create({ data: { ...summaryJobData, finishedAt: new Date() } });
    const activeSummaryFailure = await prisma.job.create({ data: { ...summaryJobData, payloadJson: JSON.stringify({ itemId: summaries[1].id }) } });
    await prisma.job.create({ data: { libraryId: library.id, type: "generate_summary", status: "queued", contentObjectId: summaries[1].contentObjectId } });

    const resolved = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Recovered", status: "ready" } });
    const deleted = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Deleted", status: "failed", deletedAt: new Date() } });
    for (const item of [resolved, deleted]) await prisma.job.create({ data: { libraryId: library.id, type: "ingest_url", status: "failed", payloadJson: JSON.stringify({ itemId: item.id }) } });
    const email = await prisma.job.create({ data: { libraryId: library.id, type: "ingest_newsletter", status: "failed", attempts: 3, error: "secret-email-error", createdAt: old, finishedAt: old } });
    const unsupported = await prisma.job.create({ data: { libraryId: library.id, type: "legacy_job", status: "failed", createdAt: old, finishedAt: old } });
    const source = await prisma.source.create({ data: { libraryId: library.id, name: "Already processing", type: "rss", url: "https://example.com/rss" } });
    const sourceFailure = await prisma.job.create({ data: { libraryId: library.id, type: "fetch_source", sourceId: source.id, status: "failed" } });
    await prisma.job.create({ data: { libraryId: library.id, type: "fetch_source", sourceId: source.id, status: "queued" } });
    const foreignJob = await prisma.job.create({ data: { libraryId: other.id, type: "ingest_newsletter", status: "failed" } });

    const summaryView = await getTaskMonitor(library.id, "failed", "summary");
    assert.deepEqual(summaryView.failureCounts, { summary: 3, article_fetch: 104, source_fetch: 1, other: 2 });
    assert.equal(summaryView.counts.failed, 110);
    assert.deepEqual(summaryView.retryableFailureCounts, { summary: 1, article_fetch: 102, source_fetch: 1, other: 1 });
    assert.equal(summaryView.articleIssues.length, 3); // Filter before the 100-row limit.
    assert.ok(summaryView.articleIssues.every(issue => issue.kind === "summary"));
    assert.equal(summaryView.jobs.length, 0);
    assert.equal(JSON.stringify(summaryView).includes("secret-"), false);
    const fetchView = await getTaskMonitor(library.id, "failed", "article_fetch");
    assert.equal(fetchView.articleIssues.length, 100);
    assert.ok(fetchView.articleIssues.every(issue => issue.kind === "content"));
    assert.equal(fetchView.jobs.length, 0);
    const otherView = await getTaskMonitor(library.id, "failed", "other");
    assert.equal(otherView.articleIssues.length, 0);
    assert.deepEqual(new Set(otherView.jobs.map(job => job.id)), new Set([email.id, unsupported.id]));
    const sourceView = await getTaskMonitor(library.id, "failed", "source_fetch");
    assert.deepEqual(sourceView.jobs.map(job => job.id), [sourceFailure.id]);
    assert.equal(sourceView.articleIssues.length, 0);

    assert.deepEqual(await retryMonitoredFailures(library.id, "summary"), { queued: 1, skipped: 2, total: 3 });
    assert.deepEqual(await retryMonitoredFailures(library.id, "summary"), { queued: 0, skipped: 3, total: 3 });
    assert.equal(await retryMonitoredJob(library.id, obsoleteSummary.id), "conflict");
    assert.equal(await retryMonitoredJob(library.id, activeFetchFailure.id), "conflict");
    const retried = await prisma.job.findUniqueOrThrow({ where: { id: summaryJob.id } });
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 0);
    assert.equal(retried.error, null);
    assert.equal(retried.finishedAt, null);
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: activeSummaryFailure.id } })).status, "failed");
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: "fetch-job-0" } })).status, "failed");

    assert.deepEqual(await retryMonitoredFailures(library.id, "article_fetch"), { queued: 102, skipped: 2, total: 104 });
    assert.deepEqual(await retryMonitoredFailures(library.id, "article_fetch"), { queued: 0, skipped: 104, total: 104 });
    assert.equal(await prisma.job.count({ where: { libraryId: library.id, type: { in: ["ingest_url", "refetch_article"] }, status: "queued" } }), 102);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: missingFetch.id } })).status, "failed");
    assert.deepEqual(await retryMonitoredFailures(library.id, "other"), { queued: 1, skipped: 1, total: 2 });
    assert.deepEqual(await retryMonitoredFailures(library.id, "source_fetch"), { queued: 0, skipped: 1, total: 1 });
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: foreignJob.id } })).status, "failed");
    assert.equal((await getTaskMonitor(other.id, "failed")).counts.failed, 1);
  } finally {
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("other failures count current problems once per subject instead of every failed run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-other-failures-"));
  const previous = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { getTaskMonitor, retryMonitoredFailures } = await import("./task-monitor.ts");
  try {
    const library = await prisma.library.create({ data: { account: { create: { name: "History" } }, name: "History" } });
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000);
    const source = (name: string, status = "active") => prisma.source.create({ data: { libraryId: library.id, name, type: "rss", url: `https://example.com/${name}`, status } });
    const refresh = (sourceId: string, status: string, hoursAgo: number, legacy = false) => prisma.job.create({ data: {
      libraryId: library.id, type: "fetch_source", status, createdAt: at(hoursAgo),
      sourceId: legacy ? null : sourceId, payloadJson: JSON.stringify({ sourceId })
    } });
    const flaky = await source("flaky");
    const recovered = await source("recovered");
    const removed = await source("removed", "unsubscribed");
    for (const hoursAgo of [5, 4, 3]) await refresh(flaky.id, "failed", hoursAgo, hoursAgo === 5);
    const flakyLatest = await refresh(flaky.id, "failed", 2);
    await refresh(flaky.id, "succeeded", 6); // Older than the failures: still broken.
    for (const hoursAgo of [9, 8, 7]) await refresh(recovered.id, "failed", hoursAgo);
    await refresh(recovered.id, "succeeded", 1);
    await refresh(removed.id, "failed", 1);

    const pdf = await prisma.contentObject.create({ data: { type: "pdf", canonicalKey: "pdf" } });
    await prisma.job.create({ data: { libraryId: library.id, type: "parse_pdf", status: "failed", contentObjectId: pdf.id, createdAt: at(3) } });
    await prisma.job.create({ data: { libraryId: library.id, type: "parse_pdf", status: "succeeded", contentObjectId: pdf.id, createdAt: at(1) } });
    const exportFailure = await prisma.job.create({ data: { libraryId: library.id, type: "export_account", status: "failed", createdAt: at(1), payloadJson: JSON.stringify({ accountId: library.accountId, exportId: "x" }) } });
    await prisma.job.create({ data: { libraryId: library.id, type: "export_account", status: "succeeded", createdAt: at(4) } });
    const emails = [];
    for (let i = 0; i < 2; i++) emails.push(await prisma.job.create({ data: { libraryId: library.id, type: "ingest_newsletter", status: "failed" } }));

    const view = await getTaskMonitor(library.id, "failed");
    assert.deepEqual(view.failureCounts, { summary: 0, article_fetch: 0, source_fetch: 1, other: 3 });
    assert.equal(view.counts.failed, 4);
    assert.deepEqual(new Set(view.jobs.map(job => job.id)), new Set([flakyLatest.id, exportFailure.id, ...emails.map(job => job.id)]));
    assert.deepEqual((await getTaskMonitor(library.id, "failed", "source_fetch")).jobs.map(job => job.id), [flakyLatest.id]);
    assert.deepEqual(await retryMonitoredFailures(library.id, "other"), { queued: 3, skipped: 0, total: 3 });
    assert.deepEqual(await retryMonitoredFailures(library.id, "source_fetch"), { queued: 1, skipped: 0, total: 1 });
    // A source stays a problem while its retry is pending, then clears once the retry succeeds.
    assert.deepEqual((await getTaskMonitor(library.id, "failed")).failureCounts, { summary: 0, article_fetch: 0, source_fetch: 1, other: 0 });
    await prisma.job.update({ where: { id: flakyLatest.id }, data: { status: "succeeded", createdAt: new Date() } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 0);
  } finally {
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
