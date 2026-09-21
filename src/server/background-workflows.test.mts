import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  } finally {
    t.mock.restoreAll();
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(directory, { recursive: true, force: true });
  }
});
