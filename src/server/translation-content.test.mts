import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { assembleTranslation, createTranslationPlan, parseTranslationResponse, splitTranslationText, translationSourceHash } from "./translation-content.ts";

test("long paragraphs split without losing characters, punctuation or surrogate pairs", () => {
  const text = "A sentence. 中文长段落😀Some words! ".repeat(2000);
  const parts = splitTranslationText(text, 300);
  assert.ok(parts.length > 100);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => part.length <= 300 && !/[\uD800-\uDBFF]$/u.test(part)));
});

test("translation assembly preserves document structure and treats model output as text", () => {
  const html = '<h2>Heading</h2><p>Hello <a href="https://example.com">world</a>!</p><img src="/api/article-images/test/photo.png"><pre><code>console.log("original")</code></pre><script>alert(1)</script>';
  const plan = createTranslationPlan("Title", html, "Hello world", 30);
  assert.ok(!plan.chunks.flat().some(unit => unit.text.includes("console.log")));
  const parts = plan.chunks.map(chunk => parseTranslationResponse(JSON.stringify(chunk.map(unit => ({ ...unit, text: `<script>中文 ${unit.text}</script>` }))), chunk));
  const result = assembleTranslation(plan, parts);
  assert.match(result.title, /中文 Title/);
  const dom = new JSDOM(result.articleHtml);
  try {
    assert.equal(dom.window.document.querySelector("script"), null);
    assert.equal(dom.window.document.querySelector("a")?.getAttribute("href"), "https://example.com");
    assert.equal(dom.window.document.querySelector("img")?.getAttribute("src"), "/api/article-images/test/photo.png");
    assert.equal(dom.window.document.querySelector("code")?.textContent, 'console.log("original")');
    assert.match(dom.window.document.querySelector("h2")?.textContent ?? "", /中文 Heading/);
  } finally { dom.window.close(); }
  assert.throws(() => assembleTranslation(plan, parts.slice(1)), /incomplete/);
});

test("translation validation rejects missing, duplicate, empty and unknown segments", () => {
  const units = [{ id: "0:0", text: "Hello " }, { id: "1:0", text: "world" }];
  for (const values of [[], [{ id: "0:0", text: "" }, { id: "1:0", text: "世界" }], [{ id: "0:0", text: "你" }, { id: "0:0", text: "好" }], [{ id: "0:0", text: "你" }, { id: "2:0", text: "好" }]]) {
    assert.throws(() => parseTranslationResponse(JSON.stringify(values), units));
  }
  assert.deepEqual(parseTranslationResponse('```json\n[{"id":"1:0","text":"世界"},{"id":"0:0","text":"你好"}]\n```', units), [{ id: "0:0", text: "你好 " }, { id: "1:0", text: "世界" }]);
});

test("source revision includes title, full text, and HTML and supports plaintext fallback", () => {
  const item = { title: "Title", document: { text: "First\n\nSecond", articleHtml: null as string | null } };
  const hash = translationSourceHash(item);
  assert.notEqual(hash, translationSourceHash({ ...item, title: "Updated" }));
  assert.notEqual(hash, translationSourceHash({ ...item, document: { ...item.document, articleHtml: "<p>New</p>" } }));
  const plan = createTranslationPlan(item.title, null, item.document.text, 100);
  const result = assembleTranslation(plan, plan.chunks);
  assert.equal(result.articleHtml, "<p>First</p><p>Second</p>");
});
