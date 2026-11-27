import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { assembleTranslation, createTranslationPlan, formatTranslationInput, parseTranslationResponse, splitTranslationText, translationDelimiterTag, translationSourceHash } from "./translation-content.ts";

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

test("delimiter-tagged translation format handles raw quotes, backslashes, and colons without JSON escaping", () => {
  const units = [
    { id: "0:0", text: 'The "mark-to-market" price: a\\b {test} ' },
    { id: "1:0", text: "Second line." }
  ];
  const tag = translationDelimiterTag(units);
  const input = formatTranslationInput(units, tag);
  assert.match(input, /<<<SEG 0:0>>>/);
  const modelOutput = [
    '<<<SEG 0:0>>>',
    '所谓的"按市值计价"价格: a\\b {"raw": true}',
    '<<<END 0:0>>>',
    '<<<SEG 1:0>>>',
    '第二行。',
    '<<<END 1:0>>>'
  ].join("\n");
  assert.deepEqual(parseTranslationResponse(modelOutput, units, tag), [
    { id: "0:0", text: '所谓的"按市值计价"价格: a\\b {"raw": true} ' },
    { id: "1:0", text: "第二行。" }
  ]);
  assert.throws(() => parseTranslationResponse("<<<SEG 0:0>>>\n仅一段\n<<<END 0:0>>>", units, tag), /missing segments: 1:0/);
});
