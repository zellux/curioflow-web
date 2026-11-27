import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArticleImportCsv } from "../lib/article-import-csv.ts";

test("Readwise CSV supports BOM, commas, escaped quotes, multiline fields and strict headers", () => {
  const rows = parseArticleImportCsv('\uFEFFTitle,URL,Saved date,Location,Reading progress\r\n"A, ""quote""\nnext",https://example.com/a,2024-01-02,archive,0.5\r\n', "readwise");
  assert.equal(rows[0].title, 'A, "quote"\nnext');
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].progress, 0.5);
  assert.equal(rows[0].savedAt, '2024-01-02T00:00:00.000Z');
  assert.throws(() => parseArticleImportCsv('Title,URL\na,b', "readwise"), /Missing Readwise/);
  assert.throws(() => parseArticleImportCsv('"unclosed', "readwise"), /Unclosed/);
});

test("Matter imports original article URLs and preserves explicit saved dates and archive status", () => {
  const csv = "Article Title,URL,Original URL,Saved At,Archived,Read At\n"
    + "First,https://web.getmatter.com/one,https://example.com/one,2024-01-02,true,2024-02-02\n"
    + "Second,https://example.com/two,,,,2024-02-03\n";
  assert.deepEqual(parseArticleImportCsv(csv, "matter"), [
    { title: "First", url: "https://example.com/one", savedAt: "2024-01-02T00:00:00.000Z", archived: true, progress: 0 },
    { title: "Second", url: "https://example.com/two", savedAt: null, archived: false, progress: 0 }
  ]);
  assert.throws(() => parseArticleImportCsv("Title,Date\nArticle,2024-01-02", "matter"), /Matter CSV must include/);
});

test("Instapaper imports archived articles and custom folders with Unix save timestamps", () => {
  const csv = 'URL,Title,Selection,Folder,Timestamp,Tags\r\n'
    + 'https://example.com/one,"First, with comma","Line one\nLine two",Archive,1704153600,tech\r\n'
    + 'https://example.com/two,Second,,My folder,1704153600000,\r\n';
  assert.deepEqual(parseArticleImportCsv(csv, "instapaper"), [
    { title: "First, with comma", url: "https://example.com/one", savedAt: "2024-01-02T00:00:00.000Z", archived: true, progress: 0 },
    { title: "Second", url: "https://example.com/two", savedAt: "2024-01-02T00:00:00.000Z", archived: false, progress: 0 }
  ]);
  assert.throws(() => parseArticleImportCsv(csv, "pocket"), /Missing Pocket column/);
});

test("Pocket CSV imports both unread and archive entries and allows additional columns", () => {
  const csv = "title,url,time_added,tags,status,item_id\n"
    + "First,https://example.com/one,1704153600,tech,archive,1\n"
    + "Second,https://example.com/two,invalid,,unread,2\n";
  assert.deepEqual(parseArticleImportCsv(csv, "pocket"), [
    { title: "First", url: "https://example.com/one", savedAt: "2024-01-02T00:00:00.000Z", archived: true, progress: 0 },
    { title: "Second", url: "https://example.com/two", savedAt: null, archived: false, progress: 0 }
  ]);
});

test("Article import preserves existing/deleted state, queues new articles once and retains archive/progress", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-readwise-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { importArticles } = await import("./ingest/article-import.ts");
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
    assert.equal((await importArticles(library.id, rows, false)).missing, 1);
    assert.equal(await prisma.item.count(), 1);
    assert.equal(await prisma.source.count(), 0);
    const first = await importArticles(library.id, rows);
    assert.equal(first.imported, 1, JSON.stringify(first)); assert.equal(first.existing, 2); assert.equal(first.invalid, 1);
    assert.deepEqual(await prisma.item.findUnique({ where: { id: old.id } }), old);
    const added = await prisma.item.findFirstOrThrow({ where: { url: "https://example.com/new" } });
    assert.equal(added.title, base.title); assert.equal(added.readStatus, "reading"); assert.equal(added.readingProgress, 0.5);
    assert.equal(added.archivedAt?.toISOString(), base.savedAt); assert.equal(added.createdAt.toISOString(), base.savedAt);
    assert.equal(await prisma.job.count({ where: { type: "ingest_url", status: "queued" } }), 1);
    assert.equal((await importArticles(library.id, rows)).imported, 0);
    // The canonical save path also preserves state if another import wins a race.
    await saveArticleItemToLibrary({ libraryId: library.id, sourceId: added.sourceId!, url: added.url!, preserveExisting: true });
    assert.deepEqual(await prisma.item.findUnique({ where: { id: added.id } }), added);
    assert.equal(await prisma.job.count(), 1);
    const pocketDuplicate = parseArticleImportCsv(
      "title,url,time_added,tags,status\nDifferent title,https://example.com/new,1704153600,,unread", "pocket"
    );
    assert.equal((await importArticles(library.id, pocketDuplicate)).existing, 1);
    assert.deepEqual(await prisma.item.findUnique({ where: { id: added.id } }), added);
    const other = await prisma.library.create({ data: { accountId: account.id, name: "Other" } });
    assert.equal((await importArticles(other.id, [rows[0]])).imported, 1);
  } finally { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
});
