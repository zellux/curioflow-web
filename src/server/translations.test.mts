import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function parseMockTaggedInput(content: string): Array<{ id: string; text: string }> {
  const units: Array<{ id: string; text: string }> = [];
  for (const match of content.matchAll(/<<<SEG ([^>\s]+)>>>\n([\s\S]*?)\n<<<END \1>>>/g)) {
    units.push({ id: match[1], text: match[2] });
  }
  return units;
}

function formatMockTaggedOutput(units: Array<{ id: string; text: string }>) {
  return units.map(unit => `<<<SEG ${unit.id}>>>\n${unit.text}\n<<<END ${unit.id}>>>`).join("\n");
}

test("on-demand translations capture language, resume chunks, reuse results and isolate accounts and revisions", async t => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-translation-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { isTranslationTargetLanguage, translationItem, listArticleTranslations, requestArticleTranslation, processArticleTranslationJob } = await import("./translations.ts");
  let calls = 0;
  let fail = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls += 1;
    if (fail && calls === 2) throw new Error("Temporary network error");
    const body = JSON.parse(String(init.body));
    const units = parseMockTaggedInput(body.messages[1].content);
    const zh = body.messages[0].content.includes("Simplified Chinese");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: formatMockTaggedOutput(units.map(unit => ({ ...unit, text: `${zh ? "中文" : "English"} ${unit.text}` }))) } }] });
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
    const retryingTranslations = await listArticleTranslations(item);
    assert.equal(retryingTranslations[0].status, "queued");
    assert.equal(retryingTranslations[0].partial, true);
    assert.match(retryingTranslations[0].title!, /中文/);
    assert.match(retryingTranslations[0].html!, /readerTranslationPending/);
    fail = false;
    await prisma.job.update({ where: { id: entry.jobId }, data: { nextRunAt: null } });
    await processArticleTranslationJob(entry.jobId);
    const translations = await listArticleTranslations(item);
    assert.equal(translations[0].status, "succeeded");
    assert.equal(translations[0].partial, false);
    assert.doesNotMatch(translations[0].html!, /readerTranslationPending/);
    assert.equal(translations[0].language, "zh-Hans");
    assert.match(translations[0].title!, /中文/);
    assert.equal(calls, entry.totalChunks + 1); // Only the failed chunk is retried.
    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
    await requestArticleTranslation(item, account.id);
    assert.equal(await prisma.articleTranslation.count(), 2);
    await prisma.llmSetting.update({ where: { accountId: account.id }, data: { systemLanguage: "zh-Hans" } });
    await requestArticleTranslation(item, account.id);
    assert.equal(await prisma.job.count(), 2); // Reuse the saved Chinese translation.
    assert.equal(isTranslationTargetLanguage("ja"), true);
    assert.equal(isTranslationTargetLanguage("toString"), false);
    assert.equal(await requestArticleTranslation(item, account.id, "ja"), "ja");
    const japanese = await prisma.articleTranslation.findFirstOrThrow({ where: { itemId: item.id, language: "ja" } });
    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
    await processArticleTranslationJob(japanese.jobId);
    assert.equal((await listArticleTranslations(item)).find(entry => entry.language === "ja")?.status, "succeeded");
    assert.equal((await prisma.llmSetting.findUniqueOrThrow({ where: { accountId: account.id } })).systemLanguage, "zh-Hans");
    await prisma.document.update({ where: { id: document.id }, data: { text: "Updated source" } });
    const updated = (await translationItem(item.id, library.id, account.id))!;
    assert.deepEqual(await listArticleTranslations(updated), []);
    await prisma.item.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    assert.equal(await translationItem(item.id, library.id, account.id), null);

    await t.test("translates an unsaved private newsletter", async () => {
      const newsletter = await prisma.contentObject.create({ data: {
        type: "newsletter", canonicalKey: "translation-newsletter",
        cacheScope: "account_private", ownerAccountId: account.id
      } });
      const newsletterDocument = await prisma.document.create({ data: {
        contentObjectId: newsletter.id, ownerAccountId: account.id, contentType: "text/html",
        text: "This week's news", articleHtml: "<p>This week's news</p>",
        contentHash: "newsletter-hash", parserVersion: "newsletter-email-v1"
      } });
      const newsletterItem = await prisma.item.create({ data: {
        libraryId: library.id, type: "newsletter", title: "Weekly news", status: "ready",
        contentObjectId: newsletter.id, documentId: newsletterDocument.id, savedToLibrary: false
      } });
      const source = await translationItem(newsletterItem.id, library.id, account.id);
      assert.ok(source);
      assert.equal(await translationItem(newsletterItem.id, otherLibrary.id, other.id), null);
      assert.equal(await translationItem(newsletterItem.id, library.id, other.id), null);

      process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
      await requestArticleTranslation(source, account.id, "zh-Hans");
      const { jobId } = await prisma.articleTranslation.findFirstOrThrow({ where: { itemId: source.id } });
      process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
      await processArticleTranslationJob(jobId);

      const [translation] = await listArticleTranslations(source);
      assert.equal(translation.status, "succeeded");
      assert.equal(translation.language, "zh-Hans");
      assert.match(translation.title!, /中文 Weekly news/);
      assert.match(translation.html!, /中文 This week's news/);
      assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: source.id } })).savedToLibrary, false);
    });
  } finally {
    await prisma.$disconnect();
    process.env = environment;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("OpenRouter GLM translations disable reasoning, run chunks concurrently, and resume sparse progress", async t => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-translation-or-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { translationItem, listArticleTranslations, requestArticleTranslation, processArticleTranslationJob } = await import("./translations.ts");
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  let failChunkTwo = true;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls += 1;
    const callNumber = calls;
    const body = JSON.parse(String(init.body)) as { reasoning?: unknown; provider?: unknown; messages: Array<{ content: string }> };
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.deepEqual(body.provider, { sort: "throughput" });
    const units = parseMockTaggedInput(body.messages[1].content);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 25));
    inFlight -= 1;
    if (failChunkTwo && callNumber === 2) throw new Error("Temporary chunk error");
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: formatMockTaggedOutput(units.map(unit => ({ ...unit, text: `译:${unit.text}` }))) }
      }]
    });
  });

  try {
    const account = await prisma.account.create({ data: { name: "OpenRouter GLM test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "A" } });
    const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: "or-glm-translation" } });
    const document = await prisma.document.create({
      data: {
        contentObjectId: content.id,
        ownerAccountId: account.id,
        contentType: "article",
        text: "Sentence about OpenRouter GLM translation speed. ".repeat(220),
        contentHash: "hash-or",
        parserVersion: "test"
      }
    });
    const created = await prisma.item.create({
      data: { libraryId: library.id, type: "article", title: "GLM Speed", status: "ready", contentObjectId: content.id, documentId: document.id }
    });
    await prisma.llmSetting.create({
      data: {
        accountId: account.id,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "z-ai/glm-5.2",
        apiKey: "test-or-key",
        systemLanguage: "zh-Hans",
        summaryConcurrency: 5
      }
    });
    const item = (await translationItem(created.id, library.id, account.id))!;
    await requestArticleTranslation(item, account.id, "zh-Hans");
    const entry = await prisma.articleTranslation.findFirstOrThrow();
    assert.ok(entry.totalChunks >= 3);

    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
    await processArticleTranslationJob(entry.jobId);
    assert.ok(maxInFlight >= 2, `expected concurrent translation chunks, saw maxInFlight=${maxInFlight}`);
    const partial = await prisma.articleTranslation.findUniqueOrThrow({ where: { id: entry.id } });
    assert.ok(partial.completedChunks >= 2);
    assert.equal(partial.articleHtml, null);
    const partialList = await listArticleTranslations(item);
    assert.equal(partialList[0].status, "queued");
    assert.equal(partialList[0].partial, true);
    assert.match(partialList[0].html!, /译:/);
    assert.match(partialList[0].html!, /readerTranslationPending/);

    failChunkTwo = false;
    await prisma.job.update({ where: { id: entry.jobId }, data: { nextRunAt: null } });
    await processArticleTranslationJob(entry.jobId);
    const translations = await listArticleTranslations(item);
    assert.equal(translations[0].status, "succeeded");
    assert.match(translations[0].title!, /译:GLM Speed/);
    assert.equal(calls, entry.totalChunks + 1);
  } finally {
    await prisma.$disconnect();
    process.env = environment;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("translated HTML signs cached article image URLs for complete and partial translations and keeps remote images intact", async t => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-translation-images-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
  process.env.CURIOFLOW_SECRET_KEY = "translation-image-signing-key";
  delete process.env.CURIOFLOW_APP_URL;
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { JSDOM } = await import("jsdom");
  const { prisma } = await import("./db.ts");
  const { validArticleImageSignature } = await import("./article-image-access.ts");
  const { translationItem, listArticleTranslations, requestArticleTranslation, processArticleTranslationJob } = await import("./translations.ts");

  let calls = 0;
  let failSecondCall = true;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls += 1;
    if (failSecondCall && calls === 2) throw new Error("Pause after chunk 1");
    const body = JSON.parse(String(init.body));
    const units = parseMockTaggedInput(body.messages[1].content);
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: formatMockTaggedOutput(units.map(unit => ({ ...unit, text: `中文 ${unit.text}` }))) }
      }]
    });
  });

  try {
    const account = await prisma.account.create({ data: { name: "Translation images test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "A" } });
    const content = await prisma.contentObject.create({ data: { type: "article", canonicalKey: "translation-images" } });
    const created = await prisma.item.create({
      data: { libraryId: library.id, type: "article", title: "Agents with Figures", status: "ready", contentObjectId: content.id }
    });
    const imagePath = `/api/article-images/${created.id.slice(-2)}/${created.id}/${"b".repeat(64)}.png`;
    const remoteImage = "https://cdn.example.com/diagram.svg";
    const paragraph = "A paragraph explaining multi-agent scaling with a figure below. ".repeat(180);
    const articleHtml = `<p>${paragraph}</p><figure><img src="${imagePath}" alt="Figure 1"><figcaption>Figure 1 caption.</figcaption></figure><img src="${remoteImage}" alt="Remote"><p>${paragraph}</p>`;
    const document = await prisma.document.create({
      data: {
        contentObjectId: content.id,
        ownerAccountId: account.id,
        contentType: "markdown",
        text: `${paragraph}\n\nFigure 1 caption.\n\n${paragraph}`,
        articleHtml,
        contentHash: "hash-images",
        parserVersion: "test"
      }
    });
    await prisma.item.update({ where: { id: created.id }, data: { documentId: document.id } });
    await prisma.llmSetting.create({
      data: { accountId: account.id, provider: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test", systemLanguage: "zh-Hans" }
    });

    const item = (await translationItem(created.id, library.id, account.id))!;
    await requestArticleTranslation(item, account.id, "zh-Hans");
    const entry = await prisma.articleTranslation.findFirstOrThrow({ where: { itemId: item.id } });
    assert.ok(entry.totalChunks >= 2);

    const inspectImages = (html: string) => {
      const dom = new JSDOM(html);
      try {
        return [...dom.window.document.querySelectorAll("img")].map(img => img.getAttribute("src") ?? "");
      } finally {
        dom.window.close();
      }
    };

    // Partial translation should also sign cached article image URLs.
    process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
    await processArticleTranslationJob(entry.jobId);
    const [partial] = await listArticleTranslations(item, { requestOrigin: "https://reader.example.com" });
    assert.equal(partial.partial, true);
    const partialImages = inspectImages(partial.html!);
    assert.equal(partialImages.length, 2);
    const partialSigned = new URL(partialImages[0]);
    assert.equal(partialSigned.origin, "https://reader.example.com");
    assert.equal(partialSigned.pathname, imagePath);
    assert.equal(partialSigned.searchParams.get("item"), item.id);
    assert.equal(validArticleImageSignature(imagePath, item.id, partialSigned.searchParams.get("signature")!, "translation-image-signing-key"), true);
    assert.equal(partialImages[1], remoteImage);

    // Finish the translation and verify origin-specific signing, cache isolation, and CURIOFLOW_APP_URL precedence.
    failSecondCall = false;
    await prisma.job.update({ where: { id: entry.jobId }, data: { nextRunAt: null } });
    await processArticleTranslationJob(entry.jobId);

    const [completeA] = await listArticleTranslations(item, { requestOrigin: "https://reader.example.com" });
    assert.equal(completeA.status, "succeeded");
    const completeAImages = inspectImages(completeA.html!);
    const signedA = new URL(completeAImages[0]);
    assert.equal(signedA.origin, "https://reader.example.com");
    assert.equal(signedA.pathname, imagePath);
    assert.equal(signedA.searchParams.get("item"), item.id);
    assert.equal(validArticleImageSignature(imagePath, item.id, signedA.searchParams.get("signature")!, "translation-image-signing-key"), true);
    assert.equal(completeAImages[1], remoteImage);

    const [completeLan] = await listArticleTranslations(item, { requestOrigin: "http://192.168.3.30:3000" });
    const signedLan = new URL(inspectImages(completeLan.html!)[0]);
    assert.equal(signedLan.origin, "http://192.168.3.30:3000");
    assert.equal(signedLan.pathname, imagePath);
    assert.equal(validArticleImageSignature(imagePath, item.id, signedLan.searchParams.get("signature")!, "translation-image-signing-key"), true);

    const [unsigned] = await listArticleTranslations(item);
    assert.equal(inspectImages(unsigned.html!)[0], imagePath);

    process.env.CURIOFLOW_APP_URL = "https://canonical.example.com";
    const [canonical] = await listArticleTranslations(item, { requestOrigin: "http://127.0.0.1:3000" });
    const signedCanonical = new URL(inspectImages(canonical.html!)[0]);
    assert.equal(signedCanonical.origin, "https://canonical.example.com");
    assert.equal(validArticleImageSignature(imagePath, item.id, signedCanonical.searchParams.get("signature")!, "translation-image-signing-key"), true);
  } finally {
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
    rmSync(directory, { recursive: true, force: true });
  }
});
