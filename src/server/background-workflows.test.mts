import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Real temporary database: validates migrations, database constraints and tenant boundaries.
test("background ingestion survives duplicate delivery, retries and stale leases", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-background-"));
  const env = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
  process.env.CURIOFLOW_NEWSLETTER_S3_BUCKET = "test-mail";
  process.env.CURIOFLOW_NEWSLETTER_INBOUND_DOMAIN = "mail.example.com";
  process.env.CURIOFLOW_NEWSLETTER_SQS_URL = "https://sqs.example.com/test";
  process.env.AWS_REGION = "us-west-2";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { enqueueSourceJob } = await import("./source-jobs.ts");
  const { enqueueNewsletterEvent, processNewsletterJob } = await import("./newsletter-jobs.ts");
  const { getTaskMonitor, retryMonitoredJob } = await import("./task-monitor.ts");
  const { recordWorkerHeartbeat } = await import("./worker-heartbeat.ts");
  const { scheduleDueSourceJobs, startQueuedBackgroundJobs } = await import("./background-jobs.ts");
  const { S3Client } = await import("@aws-sdk/client-s3");
  try {
    const account = await prisma.account.create({ data: { name: "Tasks test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "A" } });
    const other = await prisma.library.create({ data: { accountId: account.id, name: "B" } });
    const source = await prisma.source.create({ data: { libraryId: library.id, name: "Test feed", type: "rss", url: "https://example.com/feed" } });
    // SQLite legacy DATETIME strings are readable by Prisma but do not compare
    // correctly against its numeric date parameters. Exercise the actual repair.
    await prisma.$executeRaw`UPDATE sources SET next_fetch_at = ${"2026-07-10 19:27:48.123"} WHERE id = ${source.id}`;
    const dueWhere = { id: source.id, nextFetchAt: { lte: new Date("2026-09-21T00:00:00Z") } };
    assert.equal(await prisma.source.count({ where: dueWhere }), 0);
    const repair = readFileSync("prisma/migrations/0014_normalize_source_schedule_dates/migration.sql", "utf8");
    await prisma.$executeRawUnsafe(repair);
    assert.equal(await prisma.source.count({ where: dueWhere }), 1);
    assert.equal((await prisma.source.findUniqueOrThrow({ where: { id: source.id } })).nextFetchAt?.toISOString(), "2026-07-10T19:27:48.123Z");
    await prisma.$executeRawUnsafe(repair);
    assert.equal(await prisma.source.count({ where: dueWhere }), 1);
    const data = { libraryId: library.id, sourceId: source.id, type: "fetch_source", payloadJson: JSON.stringify({ sourceId: source.id, feedUrl: source.url, entries: [] }) };
    const duplicateJobs = await Promise.all(Array.from({ length: 5 }, () => enqueueSourceJob({ data })));
    assert.equal(new Set(duplicateJobs.map(job => job.id)).size, 1);
    assert.equal(await prisma.job.count({ where: { sourceId: source.id } }), 1);
    const job = duplicateJobs[0];
    assert.equal((await scheduleDueSourceJobs()).queued, 0);
    // A saturated due source must not consume the scheduler's entire limited batch.
    const next = await prisma.source.create({ data: { libraryId: library.id, name: "Second feed", type: "rss", url: "https://example.com/second" } });
    assert.equal((await scheduleDueSourceJobs(1)).queued, 1);
    assert.equal(await prisma.job.count({ where: { sourceId: next.id } }), 1);
    await prisma.job.updateMany({ where: { sourceId: next.id }, data: { status: "succeeded", finishedAt: new Date() } });
    await prisma.job.update({ where: { id: job.id }, data: { status: "failed", finishedAt: new Date(), error: "secret-token", progressJson: '{"failureCategory":"network","message":"secret-token"}' } });
    assert.equal(await retryMonitoredJob(other.id, job.id), "not_found");
    const monitor = await getTaskMonitor(library.id);
    assert.equal(monitor.counts.failed, 1);
    assert.deepEqual(monitor.failureCounts, { summary: 0, article_fetch: 0, other: 1 });
    assert.equal(monitor.jobs.find(row => row.id === job.id)?.sourceName, "Test feed");
    assert.equal(JSON.stringify(monitor).includes("secret-token"), false);
    assert.equal((await getTaskMonitor(other.id)).jobs.length, 0);
    assert.equal(await retryMonitoredJob(library.id, job.id), "queued");
    assert.equal(await retryMonitoredJob(library.id, job.id), "conflict");
    // Another failed job for the same source cannot become active concurrently.
    const failed = await prisma.job.create({ data: { ...data, status: "failed", finishedAt: new Date() } });
    assert.equal(await retryMonitoredJob(library.id, failed.id), "conflict");
    // Simulate worker death. Real dispatch reclaims and completes the empty feed without network.
    await prisma.job.update({ where: { id: job.id }, data: { status: "running", leaseOwner: "dead-worker", lockedUntil: new Date(0), startedAt: new Date(0) } });
    await startQueuedBackgroundJobs({ libraryId: library.id, limit: 1 });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status === "succeeded") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status, "succeeded");
    const { processRssSourceJob } = await import("./ingest/rss.ts");
    const stopped = await enqueueSourceJob({ data });
    await prisma.source.update({ where: { id: source.id }, data: { status: "unsubscribed" } });
    await processRssSourceJob(stopped.id);
    assert.equal((await prisma.source.findUniqueOrThrow({ where: { id: source.id } })).status, "unsubscribed");
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: stopped.id } })).status, "succeeded");
    assert.equal(await retryMonitoredJob(library.id, failed.id), "conflict");
    await recordWorkerHeartbeat("scheduler", true);
    assert.equal((await getTaskMonitor(library.id)).workers[0].status, "online");

    await prisma.newsletterAddress.create({ data: { accountId: account.id, libraryId: library.id, tokenHash: "test-reader", address: "reader@mail.example.com" } });
    const body = JSON.stringify({ mail: { messageId: "provider-1", destination: ["reader@mail.example.com"], timestamp: new Date().toISOString(), commonHeaders: { subject: "Test issue" } }, receipt: { action: { bucketName: "test-mail", objectKey: "provider-1" } } });
    const first = await enqueueNewsletterEvent(body);
    const repeated = await enqueueNewsletterEvent(body);
    assert.equal(first?.id, repeated?.id);
    assert.ok(first);
    t.mock.method(S3Client.prototype, "send", async () => ({ Body: { transformToByteArray: async () => new TextEncoder().encode("From: Test <news@example.com>\r\nTo: reader@mail.example.com\r\nSubject: Test issue\r\nMessage-ID: <issue-1@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello newsletter reader.") } }));
    await processNewsletterJob(first.id);
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: first.id } })).status, "succeeded");
    const item = await prisma.item.findFirstOrThrow({ where: { libraryId: library.id, type: "newsletter" } });
    assert.equal(item.savedToLibrary, false);
    await prisma.item.update({ where: { id: item.id }, data: { archivedAt: new Date(), readStatus: "read" } });
    // Same Message-ID arriving under a different provider ID still must not duplicate/reset state.
    const second = await enqueueNewsletterEvent(body.replaceAll("provider-1", "provider-2"));
    assert.ok(second);
    await processNewsletterJob(second.id);
    assert.equal(await prisma.item.count({ where: { libraryId: library.id, type: "newsletter" } }), 1);
    assert.ok((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).archivedAt);
    assert.equal((await getTaskMonitor(library.id)).jobs.find(row => row.id === second.id)?.outcome, "duplicate");
    await assert.rejects(enqueueNewsletterEvent(body.replace("test-mail", "wrong-bucket")), /Unexpected/);
    // Historical jobs and failed subscriptions are not article problems.
    const old = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    await prisma.job.create({ data: { libraryId: library.id, type: "generate_summary", status: "failed", createdAt: old, finishedAt: old } });
    const issueItem = await prisma.item.create({ data: { libraryId: library.id, title: "Broken article", type: "article", status: "failed" } });
    const issueJob = await prisma.job.create({ data: { libraryId: library.id, type: "ingest_url", status: "failed", createdAt: old, finishedAt: old, payloadJson: JSON.stringify({ itemId: issueItem.id }) } });
    await prisma.job.create({ data: { libraryId: library.id, type: "ingest_url", status: "failed", createdAt: old, finishedAt: new Date(old.getTime() - 1000), payloadJson: JSON.stringify({ itemId: issueItem.id }) } });
    const failures = await getTaskMonitor(library.id, "failed");
    assert.equal(failures.counts.failed, 2);
    assert.deepEqual(failures.failureCounts, { summary: 0, article_fetch: 1, other: 1 });
    assert.equal(failures.articleIssues.length, 1);
    assert.equal(failures.articleIssues[0].jobId, issueJob.id);
    assert.equal((await getTaskMonitor(other.id, "failed")).articleIssues.length, 0);
    await prisma.item.update({ where: { id: issueItem.id }, data: { status: "ready" } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 1);
    assert.equal(await retryMonitoredJob(library.id, issueJob.id), "conflict");
    await prisma.item.update({ where: { id: issueItem.id }, data: { status: "failed", deletedAt: new Date() } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 1);
    const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: "issue-summary" } });
    const document = await prisma.document.create({ data: { contentObjectId: content.id, contentType: "article", text: "Test", contentHash: "issue-hash", parserVersion: "test", metadataJson: '{"summaryStatus":"failed"}' } });
    const summaryItem = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Summary issue", status: "ready", contentObjectId: content.id, documentId: document.id } });
    for (let i = 0; i < 3; i++) await prisma.job.create({ data: { libraryId: library.id, contentObjectId: content.id, type: "generate_summary", status: "failed", payloadJson: JSON.stringify({ itemId: summaryItem.id }) } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 2);
    await prisma.item.update({ where: { id: summaryItem.id }, data: { status: "failed" } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 2);
    await prisma.item.update({ where: { id: summaryItem.id }, data: { status: "ready" } });
    await prisma.document.update({ where: { id: document.id }, data: { metadataJson: '{"summaryStatus":"succeeded"}' } });
    assert.equal((await getTaskMonitor(library.id, "failed")).counts.failed, 1);

  } finally {
    t.mock.restoreAll();
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(directory, { recursive: true, force: true });
  }
});
