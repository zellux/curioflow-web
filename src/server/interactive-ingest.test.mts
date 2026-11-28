import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("interactive ingest jumps ahead of summary backlog and async image caching preserves translations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-interactive-ingest-"));
  const env = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
  process.env.CURIOFLOW_ALLOW_MOCK_EXTRACTION = "true";
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });

  const { prisma } = await import("./db.ts");
  const { isInteractiveBackgroundJob, startQueuedBackgroundJobs } = await import("./background-jobs.ts");
  const { cachePersistedArticleImages } = await import("./ingest/articles.ts");
  const { translationSourceHash } = await import("./translation-content.ts");

  try {
    const account = await prisma.account.create({ data: { name: "Priority Test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Library" } });
    const source = await prisma.source.create({ data: { libraryId: library.id, type: "url", name: "Saved URLs" } });

    assert.equal(isInteractiveBackgroundJob({ type: "ingest_url", payloadJson: JSON.stringify({ interactive: true }) }), true);
    assert.equal(isInteractiveBackgroundJob({ type: "ingest_url", payloadJson: JSON.stringify({ interactive: false }) }), false);
    assert.equal(isInteractiveBackgroundJob({ type: "refetch_article", payloadJson: "{}" }), true);
    assert.equal(isInteractiveBackgroundJob({ type: "translate_article", payloadJson: "{}" }), true);
    assert.equal(isInteractiveBackgroundJob({ type: "generate_summary", payloadJson: "{}" }), false);

    // Queue older summary jobs before an interactive URL ingest job.
    for (let i = 0; i < 4; i += 1) {
      await prisma.job.create({
        data: {
          libraryId: library.id,
          type: "generate_summary",
          status: "queued",
          createdAt: new Date(Date.now() - 60_000 + i * 1000),
          payloadJson: JSON.stringify({ itemId: `summary-item-${i}` })
        }
      });
    }

    const contentObject = await prisma.contentObject.create({
      data: {
        canonicalKey: "url:interactive-test",
        type: "article",
        normalizedUrl: "http://127.0.0.1/interactive-article",
        urlHash: "interactive-test-hash",
        status: "pending"
      }
    });
    const item = await prisma.item.create({
      data: {
        libraryId: library.id,
        sourceId: source.id,
        contentObjectId: contentObject.id,
        type: "article",
        title: "Interactive Article",
        url: "http://127.0.0.1/interactive-article",
        status: "pending"
      }
    });
    const interactiveJob = await prisma.job.create({
      data: {
        libraryId: library.id,
        contentObjectId: contentObject.id,
        type: "ingest_url",
        status: "queued",
        payloadJson: JSON.stringify({
          generateSummary: false,
          interactive: true,
          itemId: item.id,
          url: "http://127.0.0.1/interactive-article"
        })
      }
    });

    const wake = await startQueuedBackgroundJobs({ libraryId: library.id, interactiveOnly: true });
    assert.equal(wake.started, 1);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await prisma.job.findUniqueOrThrow({ where: { id: interactiveJob.id } });
      if (current.status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: interactiveJob.id } })).status, "succeeded");
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).status, "ready");
    // Summary jobs were untouched by the interactive-only pass.
    assert.equal(await prisma.job.count({ where: { libraryId: library.id, type: "generate_summary", status: "queued" } }), 4);

    // Verify cachePersistedArticleImages updates HTML, migrates translation sourceHash, and records a LibraryChange.
    const initialHtml = '<p>Hello</p><img src="https://example.com/photo.png">';
    const doc = await prisma.document.create({
      data: {
        contentObjectId: contentObject.id,
        contentType: "markdown",
        title: "Interactive Article",
        text: "Hello",
        articleHtml: initialHtml,
        contentHash: "doc-hash-1",
        parserVersion: "test-v1"
      }
    });
    await prisma.item.update({ where: { id: item.id }, data: { documentId: doc.id, title: "Interactive Article" } });
    const oldHash = translationSourceHash({ title: "Interactive Article", document: { text: "Hello", articleHtml: initialHtml } });
    const translation = await prisma.articleTranslation.create({
      data: {
        itemId: item.id,
        language: "zh-Hans",
        sourceHash: oldHash,
        jobId: "translation-job-1",
        planJson: JSON.stringify({
          html: '<h1>Interactive Article</h1><section><p>Hello</p><img src="https://example.com/photo.png"></section>',
          chunks: []
        }),
        totalChunks: 1,
        articleHtml: '<p>你好</p><img src="https://example.com/photo.png">'
      }
    });

    const changesBefore = await prisma.libraryChange.count({ where: { libraryId: library.id, entityId: item.id } });
    const cachedImagePath = `/api/article-images/${item.id.slice(-2)}/${item.id}/${"a".repeat(64)}.png`;
    const updated = await cachePersistedArticleImages({
      articleUrl: "https://example.com/post",
      documentId: doc.id,
      initialHtml,
      itemId: item.id,
      cacheImages: async () => `<p>Hello</p><img src="${cachedImagePath}" data-original-src="https://example.com/photo.png">`
    });
    assert.equal(updated, true);

    const updatedDoc = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.match(updatedDoc.articleHtml ?? "", /\/api\/article-images\//);
    const expectedNewHash = translationSourceHash({ title: "Interactive Article", document: updatedDoc });
    assert.notEqual(expectedNewHash, oldHash);
    const updatedTranslation = await prisma.articleTranslation.findUniqueOrThrow({ where: { id: translation.id } });
    assert.equal(updatedTranslation.sourceHash, expectedNewHash);
    assert.match(updatedTranslation.articleHtml ?? "", new RegExp(cachedImagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(JSON.parse(updatedTranslation.planJson).html, new RegExp(cachedImagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const changesAfter = await prisma.libraryChange.count({ where: { libraryId: library.id, entityId: item.id } });
    assert.ok(changesAfter > changesBefore, "Background image caching should record a library change for mobile sync");
  } finally {
    await prisma.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(directory, { recursive: true, force: true });
  }
});
