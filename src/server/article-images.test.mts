import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { cacheArticleImages, copyArticleImagesForItem, readArticleImage } from "./article-images.ts";
import { createArticleHtmlRenderer, sanitizeArticleHtml } from "./reader/rendering.ts";

const articleId = "ab123456789";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function response(bytes = png) {
  return { bytes, contentType: "image/png", finalUrl: "https://example.com/image.png", headers: new Headers(), status: 200 };
}
async function temporaryDirectory(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "curioflow-images-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("article images persist, deduplicate and remain local after reader sanitization", async (t) => {
  const directory = await temporaryDirectory(t);
  let calls = 0;
  const html = await cacheArticleImages('<h2>Title</h2><picture><source srcset="/large.png"><img src="/image.png" alt="Diagram" srcset="/other.png 2x"></picture><img src="/image.png">', "https://example.com/post", articleId, {
    directory, fetchImage: async (url, options) => {
      calls++;
      assert.equal(url, "https://example.com/image.png");
      assert.equal(options.allowPrivateNetwork, undefined);
      assert.ok(options.maxBytes <= 8 * 1024 * 1024);
      return response();
    }
  });
  assert.equal(calls, 1);
  const document = new JSDOM(sanitizeArticleHtml(html) ?? "").window.document;
  const src = document.querySelector("img")?.getAttribute("src") ?? "";
  assert.match(src, /^\/api\/article-images\/89\/ab123456789\/[a-f0-9]{64}\.png$/);
  assert.equal(document.querySelectorAll("img")[1].getAttribute("src"), src);
  assert.equal(document.querySelector("img")?.getAttribute("alt"), "Diagram");
  assert.equal(document.querySelectorAll("[srcset], source").length, 0);
  const filename = src.split("/").at(-1)!;
  assert.deepEqual(await readFile(join(directory, "89", articleId, filename)), png);
  assert.equal((await readArticleImage(["89", articleId, filename], directory))?.contentType, "image/png");
  assert.deepEqual(await readdir(join(directory, "89", articleId)), [filename]);
});

test("failed downloads and active content remain remote without blocking other images", async (t) => {
  const directory = await temporaryDirectory(t);
  const html = await cacheArticleImages('<img src="/failure.png"><img src="/fake.png"><img src="/good.png">', "https://example.com/post", articleId, {
    directory, fetchImage: async (url) => {
      if (url.includes("failure")) throw new Error("403 Forbidden");
      if (url.includes("fake")) return response(Buffer.from('<svg onload="alert(1)"></svg>'));
      return response();
    }
  });
  const images = new JSDOM(html ?? "").window.document.querySelectorAll("img");
  assert.equal(images[0].getAttribute("src"), "https://example.com/failure.png");
  assert.equal(images[1].getAttribute("src"), "https://example.com/fake.png");
  assert.match(images[2].getAttribute("src")!, /^\/api\/article-images\//);
});

test("disk failures keep the original link; filenames cannot traverse storage", async (t) => {
  const directory = await temporaryDirectory(t);
  const html = await cacheArticleImages('<img src="https://example.com/image.png">', "https://example.com", articleId, {
    directory: join(directory, "\0invalid"), fetchImage: async () => response()
  });
  assert.equal(new JSDOM(html ?? "").window.document.querySelector("img")?.getAttribute("src"), "https://example.com/image.png");
  assert.equal(await readArticleImage("../../.env", directory), null);
  assert.equal(await readArticleImage(`${"a".repeat(64)}.svg`, directory), null);
  assert.equal(await readArticleImage(`${"a".repeat(64)}.png`, directory), null);
});

test("image fetch policy blocks private destinations without issuing a fetch", async (t) => {
  const directory = await temporaryDirectory(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected fetch"); };
  const source = "http://127.0.0.1/secret.png";
  const html = await cacheArticleImages(`<img src="${source}">`, "https://example.com", articleId, { directory });
  assert.equal(calls, 0);
  assert.match(html ?? "", /http:\/\/127\.0\.0\.1\/secret.png/);
});

test("lazy image URLs are resolved and cached images are not downloaded again", async (t) => {
  const directory = await temporaryDirectory(t);
  const existing = `/api/article-images/89/${articleId}/${"a".repeat(64)}.png`;
  let calls = 0;
  const html = await cacheArticleImages(`<img src="${existing}"><img src="data:image/gif;base64,abc" data-src="//example.com/lazy.png">`, "https://example.com/post", articleId, {
    directory, fetchImage: async (url) => { calls++; assert.equal(url, "https://example.com/lazy.png"); return response(); }
  });
  assert.equal(calls, 1);
  assert.equal(new JSDOM(html ?? "").window.document.querySelector("img")?.getAttribute("src"), existing);
});


test("mobile rendering retains original image URLs without sharing browser sessions", () => {
  const renderer = createArticleHtmlRenderer();
  try {
    const html = `<img src="/api/article-images/89/${articleId}/${"a".repeat(64)}.png" data-original-src="https://example.com/image.png" alt="Diagram">`;
    const local = renderer.render(html, "", "web").html ?? "";
    const mobile = renderer.render(html, "", "mobile", true).html ?? "";
    assert.match(local, /src="\/api\/article-images\//);
    assert.match(mobile, /src="https:\/\/example.com\/image.png"/);
    assert.doesNotMatch(mobile, /data-original-src/);
  } finally { renderer.close(); }
});


test("article IDs partition identical images, and refetches reuse the same path", async (t) => {
  const directory = await temporaryDirectory(t);
  const cache = (id: string) => cacheArticleImages('<img src="https://example.com/image.png">', "https://example.com", id, {
    directory, fetchImage: async () => response()
  });
  const first = await cache(articleId);
  const other = await cache("cd-other-article");
  assert.equal(await cache(articleId), first);
  const pathFor = (html: string | null) => new JSDOM(html ?? "").window.document.querySelector("img")!.getAttribute("src")!.split("/").slice(3);
  const firstPath = pathFor(first);
  const otherPath = pathFor(other);
  assert.deepEqual(firstPath.slice(0, 2), ["89", articleId]);
  assert.deepEqual(otherPath.slice(0, 2), ["le", "cd-other-article"]);
  assert.equal(firstPath[2], otherPath[2]);
  assert.deepEqual((await readArticleImage(firstPath, directory))?.bytes, png);
  assert.deepEqual((await readArticleImage(otherPath, directory))?.bytes, png);
});

test("sharded paths reject traversal and mismatched shards; legacy flat and prefix paths still load", async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = `${"a".repeat(64)}.png`;
  await writeFile(join(directory, filename), png);
  assert.deepEqual((await readArticleImage([filename], directory))?.bytes, png);
  await mkdir(join(directory, "ab", articleId), { recursive: true });
  await writeFile(join(directory, "ab", articleId, filename), png);
  assert.deepEqual((await readArticleImage(["ab", articleId, filename], directory))?.bytes, png);
  for (const path of [["xy", articleId, filename], ["..", "../secret", filename], ["89", articleId, "../secret"], ["89", articleId], ["89", articleId, filename, "extra"]]) {
    assert.equal(await readArticleImage(path, directory), null);
  }
  let calls = 0;
  const html = '<img src="https://example.com/image.png">';
  assert.equal(await cacheArticleImages(html, "https://example.com", "../secret", {
    directory, fetchImage: async () => { calls++; return response(); }
  }), html);
  assert.equal(calls, 0);
});


test("reusing article HTML copies image bytes into an independent item directory", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = await cacheArticleImages('<img src="https://example.com/image.png">', "https://example.com", articleId, {
    directory, fetchImage: async () => response()
  });
  const copied = await copyArticleImagesForItem(first, "cd-second-item", directory);
  const src = new JSDOM(copied ?? "").window.document.querySelector("img")!.getAttribute("src")!;
  assert.match(src, /^\/api\/article-images\/em\/cd-second-item\//);
  await rm(join(directory, "89", articleId), { recursive: true });
  assert.deepEqual((await readArticleImage(src.split("/").slice(3), directory))?.bytes, png);
  assert.equal(await copyArticleImagesForItem(copied, "cd-second-item", directory), copied);
});

test("missing image copies fall back to the remote original instead of another item's directory", async (t) => {
  const directory = await temporaryDirectory(t);
  const source = `/api/article-images/89/${articleId}/${"a".repeat(64)}.png`;
  const copied = await copyArticleImagesForItem(`<img src="${source}" data-original-src="https://example.com/original.png"><img src="${source}">`, "cd-second-item", directory);
  const images = new JSDOM(copied ?? "").window.document.querySelectorAll("img");
  assert.equal(images[0].getAttribute("src"), "https://example.com/original.png");
  assert.equal(images[1].hasAttribute("src"), false);
});
