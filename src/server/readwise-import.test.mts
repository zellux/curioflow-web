import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseReadwiseCsv } from "../lib/readwise-csv.ts";

test("Readwise CSV supports BOM, commas, escaped quotes, multiline fields and strict headers", () => {
  const rows = parseReadwiseCsv('\uFEFFTitle,URL,Saved date,Location,Reading progress\r\n"A, ""quote""\nnext",https://example.com/a,2024-01-02,archive,0.5\r\n');
  assert.equal(rows[0].title, 'A, "quote"\nnext');
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].progress, 0.5);
  assert.equal(rows[0].savedAt, '2024-01-02T00:00:00.000Z');
  assert.throws(() => parseReadwiseCsv('Title,URL\na,b'), /Missing Readwise/);
  assert.throws(() => parseReadwiseCsv('"unclosed'), /Unclosed/);
});

test("Readwise import preserves existing/deleted state, queues new articles once and retains archive/progress", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-readwise-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { importReadwiseArticles } = await import("./ingest/readwise.ts");
  const { saveArticleItemToLibrary, normalizeUrl } = await import("./ingest/articles.ts");
  try {
    const trailing = normalizeUrl("https://example.com/path///");
    assert.equal(trailing, "https://example.com/path");
    assert.equal(normalizeUrl(trailing), trailing);
    const account = await prisma.account.create({ data: { name: "Import test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Target" } });
    const old = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Deleted", url: "https://example.com/old", deletedAt: new Date(), archivedAt: new Date(), savedToLibrary: false } });
    const base = { title: "Imported title", savedAt: "2023-01-01T00:00:00.000Z", archived: true, progress: 0.5 };
    const rows = [{ ...base, url: "https://example.com/new?utm_source=readwise#part" }, { ...base, url: "https://example.com/new" }, { ...base, url: "https://example.com/old" }, { ...base, url: "javascript:alert(1)" }];
    assert.equal((await importReadwiseArticles(library.id, rows, false)).missing, 1);
    assert.equal(await prisma.item.count(), 1);
    assert.equal(await prisma.source.count(), 0);
    const first = await importReadwiseArticles(library.id, rows);
    assert.equal(first.imported, 1, JSON.stringify(first)); assert.equal(first.existing, 2); assert.equal(first.invalid, 1);
    assert.deepEqual(await prisma.item.findUnique({ where: { id: old.id } }), old);
    const added = await prisma.item.findFirstOrThrow({ where: { url: "https://example.com/new" } });
    assert.equal(added.title, base.title); assert.equal(added.readStatus, "reading"); assert.equal(added.readingProgress, 0.5);
    assert.equal(added.archivedAt?.toISOString(), base.savedAt); assert.equal(added.createdAt.toISOString(), base.savedAt);
    assert.equal(await prisma.job.count({ where: { type: "ingest_url", status: "queued" } }), 1);
    assert.equal((await importReadwiseArticles(library.id, rows)).imported, 0);
    // The canonical save path also preserves state if another import wins a race.
    await saveArticleItemToLibrary({ libraryId: library.id, sourceId: added.sourceId!, url: added.url!, preserveExisting: true });
    assert.deepEqual(await prisma.item.findUnique({ where: { id: added.id } }), added);
    assert.equal(await prisma.job.count(), 1);
    const other = await prisma.library.create({ data: { accountId: account.id, name: "Other" } });
    assert.equal((await importReadwiseArticles(other.id, [rows[0]])).imported, 1);
  } finally { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
});
