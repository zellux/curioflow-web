import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("retiring podcasts stops old jobs without deleting content or affecting RSS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-retire-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { scheduleDueSourceJobs } = await import("./background-jobs.ts");
  const { getLibrarySourcesForLibrary } = await import("./sources.ts");
  const { retryMonitoredJob } = await import("./task-monitor.ts");
  try {
    const account = await prisma.account.create({ data: { name: "Retirement test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Library" } });
    const podcast = await prisma.source.create({ data: { libraryId: library.id, name: "Legacy", type: "podcast", url: "https://example.com/audio.xml", nextFetchAt: new Date(0) } });
    const idlePodcast = await prisma.source.create({ data: { libraryId: library.id, name: "Idle legacy", type: "podcast", url: "https://example.com/idle.xml", nextFetchAt: new Date(0) } });
    const rss = await prisma.source.create({ data: { libraryId: library.id, name: "RSS", type: "rss", url: "https://example.com/feed" } });
    const saved = await prisma.item.create({ data: { libraryId: library.id, sourceId: podcast.id, type: "podcast", title: "Saved transcript", savedToLibrary: true } });
    const legacy = await prisma.job.create({ data: { libraryId: library.id, type: "fetch_source", payloadJson: JSON.stringify({ sourceId: podcast.id, feedTitle: "Legacy", episodes: [] }) } });
    const transcription = await prisma.job.create({ data: { libraryId: library.id, type: "transcribe_podcast", status: "running", lockedUntil: new Date(Date.now() + 60000), leaseOwner: "old-worker" } });
    assert.equal((await scheduleDueSourceJobs()).queued, 1);
    assert.equal(await prisma.job.count({ where: { sourceId: { in: [podcast.id, idlePodcast.id] } } }), 0);
    const sql = readFileSync("prisma/migrations/0015_retire_podcasts/migration.sql", "utf8");
    for (let pass = 0; pass < 2; pass++) {
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(part => part.trim())) await prisma.$executeRawUnsafe(statement);
    }
    for (const id of [legacy.id, transcription.id]) {
      const job = await prisma.job.findUniqueOrThrow({ where: { id } });
      assert.equal(job.status, "cancelled");
      assert.equal(job.lockedUntil, null);
      assert.equal(job.leaseOwner, null);
      assert.ok(job.finishedAt);
      assert.equal(await retryMonitoredJob(library.id, id), "conflict");
    }
    assert.equal((await prisma.source.findUniqueOrThrow({ where: { id: podcast.id } })).status, "disabled");
    assert.deepEqual(await prisma.item.findUnique({ where: { id: saved.id } }), saved);
    assert.equal(await prisma.job.count({ where: { sourceId: rss.id, status: "queued" } }), 1);
    assert.deepEqual((await getLibrarySourcesForLibrary(library.id)).map(source => source.id), [rss.id]);
  } finally {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
