import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("on-demand translations capture language, resume chunks, reuse results and isolate accounts and revisions", async t => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-translation-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { translationItem, listArticleTranslations, requestArticleTranslation, processArticleTranslationJob } = await import("./translations.ts");
  let calls = 0;
  let fail = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls += 1;
    if (fail && calls === 2) throw new Error("Temporary network error");
    const body = JSON.parse(String(init.body));
    const units = JSON.parse(body.messages[1].content);
    const zh = body.messages[0].content.includes("Simplified Chinese");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(units.map((unit: { id: string; text: string }) => ({ ...unit, text: `${zh ? "中文" : "English"} ${unit.text}` }))) } }] });
  });
  try {
    const account = await prisma.account.create({ data: { name: "Translation test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "A" } });
    const other = await prisma.account.create({ data: { name: "Other account" } });
    const otherLibrary = await prisma.library.create({ data: { accountId: other.id, name: "B" } });
    const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: "translation" } });
    const document = await prisma.document.create({ data: {
      contentObjectId: content.id, ownerAccountId: account.id, contentType: "article", text: "A long paragraph. ".repeat(500),
      contentHash: "hash", parserVersion: "test"
    } });
    const created = await prisma.item.create({ data: { libraryId: library.id, type: "article", title: "Title", status: "ready", contentObjectId: content.id, documentId: document.id } });
    await prisma.llmSetting.create({ data: { accountId: account.id, provider: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test", systemLanguage: "zh-Hans" } });
    const item = (await translationItem(created.id, library.id, account.id))!;
    assert.deepEqual(await listArticleTranslations(item), []);
    assert.equal(calls, 0);
    assert.equal(await translationItem(created.id, otherLibrary.id, other.id), null);
    await requestArticleTranslation(item, account.id);
    await requestArticleTranslation(item, account.id);
    assert.equal(await prisma.articleTranslation.count(), 1);
    assert.equal(await prisma.job.count(), 1);
    const entry = (await prisma.articleTranslation.findFirst())!;
    assert.ok(entry.totalChunks > 1);
    // Changing settings after enqueue must not change the language of queued work.
    await prisma.llmSetting.update({ where: { accountId: account.id }, data: { systemLanguage: "en" } });
    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
    fail = true;
    await processArticleTranslationJob(entry.jobId);
    const partial = (await prisma.articleTranslation.findUnique({ where: { id: entry.id } }))!;
    assert.equal(partial.completedChunks, 1);
    assert.equal(partial.articleHtml, null);
    assert.equal((await prisma.job.findUnique({ where: { id: entry.jobId } }))?.status, "queued");
    fail = false;
    await prisma.job.update({ where: { id: entry.jobId }, data: { nextRunAt: null } });
    await processArticleTranslationJob(entry.jobId);
    const translations = await listArticleTranslations(item);
    assert.equal(translations[0].status, "succeeded");
    assert.equal(translations[0].language, "zh-Hans");
    assert.match(translations[0].title!, /中文/);
    assert.equal(calls, entry.totalChunks + 1); // Only the failed chunk is retried.
    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
    await requestArticleTranslation(item, account.id);
    assert.equal(await prisma.articleTranslation.count(), 2);
    await prisma.llmSetting.update({ where: { accountId: account.id }, data: { systemLanguage: "zh-Hans" } });
    await requestArticleTranslation(item, account.id);
    assert.equal(await prisma.job.count(), 2); // Reuse the saved Chinese translation.
    await prisma.document.update({ where: { id: document.id }, data: { text: "Updated source" } });
    const updated = (await translationItem(item.id, library.id, account.id))!;
    assert.deepEqual(await listArticleTranslations(updated), []);
    await prisma.item.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    assert.equal(await translationItem(item.id, library.id, account.id), null);
  } finally {
    await prisma.$disconnect();
    process.env = environment;
    rmSync(directory, { recursive: true, force: true });
  }
});
