import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("URL sync previews without writes, preserves deleted items and queues normal imports once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-url-sync-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const code = readFileSync("scripts/sync-dev-urls-target.mjs", "utf8");
  try {
    const account = await prisma.account.create({ data: { name: "Sync test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Target" } });
    const old = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Deleted", url: "https://example.com/old", deletedAt: new Date(), archivedAt: new Date(), savedToLibrary: false } });
    const run = (apply: boolean) => {
      const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "--eval", code], {
        input: JSON.stringify({ libraryId: library.id, apply, urls: ["https://example.com/old?utm_source=test", "https://example.com/new#fragment", "https://example.com/new"] }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
      });
      return JSON.parse(output.split("\n").find(line => line.startsWith("CURIOFLOW_URL_SYNC_RESULT="))!.split("CURIOFLOW_URL_SYNC_RESULT=")[1]);
    };
    assert.equal(run(false).counts.missing, 1);
    assert.equal(await prisma.item.count(), 1);
    assert.equal(await prisma.source.count(), 0);
    assert.equal(await prisma.job.count(), 0);
    const applied = run(true);
    assert.equal(applied.counts.imported, 1);
    assert.equal(applied.counts.existing, 1);
    assert.equal(applied.counts.duplicate, 1);
    assert.equal(await prisma.job.count({ where: { type: "ingest_url", status: "queued" } }), 1);
    assert.deepEqual(await prisma.item.findUnique({ where: { id: old.id } }), old);
    assert.equal(run(true).counts.imported, 0);
    assert.equal(await prisma.item.count(), 2);
    assert.equal(await prisma.job.count(), 1);
  } finally {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
