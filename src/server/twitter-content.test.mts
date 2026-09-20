import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { twitterArticleHtml } from "./ingest/extractors/article.ts";
import { sanitizeArticleHtmlWithToc } from "./reader/rendering.ts";

function rendered(blocks: unknown[], extra = {}) {
  const html = twitterArticleHtml({ content_state: { blocks, ...extra } }, "fallback");
  return new JSDOM(sanitizeArticleHtmlWithToc(html, "long article ".repeat(1300), "twitter").html ?? "").window.document;
}

test("X title-case styles, headings, quotes and literal backticks survive the reader", () => {
  const document = rendered([
    ...["one", "two", "three", "four", "five", "six"].map((level) => ({ type: `header-${level}`, text: level })),
    { type: "blockquote", text: "A <quote>\nsecond line" },
    ...["Bold", "Italic", "Underline", "Strikethrough", "Code"].map((style) => ({
      type: "unstyled", text: "text", inlineStyleRanges: [{ offset: 0, length: 4, style }]
    })),
    { type: "unstyled", text: "literal `backticks` and > quote characters" }
  ]);
  for (let level = 1; level <= 6; level++) assert.ok(document.querySelector(`h${level}`));
  for (const tag of ["strong", "em", "u", "s", "code"]) assert.equal(document.querySelector(tag)?.textContent, "text");
  assert.equal(document.querySelector("blockquote")?.innerHTML, "A &lt;quote&gt;<br>second line");
  assert.match(document.body.textContent ?? "", /literal `backticks` and > quote characters/);
  assert.equal(document.querySelectorAll("[data-toc-section]").length, 4);
});

test("code blocks preserve indentation, blank lines, escaped markup and TeX literally", () => {
  const document = rendered([
    { type: "code-block", text: "  const x = `<tag>`;\n\tfoo();" },
    { type: "code-block", text: "" },
    { type: "code-block", text: "\\(literal\\)" },
    { type: "unstyled", text: "After" },
    { type: "code-block", text: "Separate" }
  ]);
  assert.equal(document.querySelectorAll("pre").length, 2);
  assert.equal(document.querySelector("pre > code")?.textContent, "  const x = `<tag>`;\n\tfoo();\n\n\\(literal\\)");
  assert.equal(document.querySelectorAll("pre br, pre tag, .katex").length, 0);
});

test("nested and mixed lists retain parentage, siblings and list boundaries", () => {
  const document = rendered([
    { type: "ordered-list-item", depth: 0, text: "Parent" },
    { type: "unordered-list-item", depth: 1, text: "Child" },
    { type: "ordered-list-item", depth: 1, text: "Other child" },
    { type: "ordered-list-item", depth: 0, text: "Sibling" },
    { type: "unstyled", text: "Break" },
    { type: "unordered-list-item", depth: 20, text: "New list" }
  ]);
  assert.equal(document.querySelectorAll("body > ol > li").length, 2);
  assert.equal(document.querySelector("ol > li > ul > li")?.textContent, "Child");
  assert.equal(document.querySelector("ol > li > ol > li")?.textContent, "Other child");
  assert.equal(document.querySelector("body > ul > li")?.textContent, "New list");
});

test("GraphQL array entity maps preserve links, media and dividers with overlapping styles", () => {
  const html = twitterArticleHtml({
    content_state: {
      blocks: [
        { type: "unstyled", text: "Read this", inlineStyleRanges: [{ offset: 5, length: 4, style: "Bold" }], entityRanges: [{ key: 1, offset: 0, length: 9 }] },
        { type: "atomic", text: " ", entityRanges: [{ key: 4, offset: 0, length: 1 }] },
        { type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] }
      ],
      entityMap: [
        { key: "1", value: { type: "LINK", data: { url: "https://example.com/?a=1&b=2" } } },
        { key: "4", value: { type: "MEDIA", data: { mediaItems: [{ mediaId: "123" }] } } },
        { key: "0", value: { type: "DIVIDER", data: {} } }
      ]
    },
    media_entities: [{ media_id: "123", ext_alt_text: 'A "diagram"', media_info: { original_img_url: "https://pbs.twimg.com/media/example.jpg" } }]
  }, "fallback");
  const document = new JSDOM(sanitizeArticleHtmlWithToc(html, "", "x").html ?? "").window.document;
  assert.equal(document.querySelector("a strong")?.textContent, "this");
  assert.equal(document.querySelector("a")?.getAttribute("href"), "https://example.com/?a=1&b=2");
  assert.equal(document.querySelector("figure img")?.getAttribute("alt"), 'A "diagram"');
  assert.equal(document.querySelectorAll("hr").length, 1);
});

test("unsafe entities and malformed ranges cannot inject HTML or discard surrounding text", () => {
  const document = rendered([
    null,
    { type: "unstyled", text: "<script>😃 safe", inlineStyleRanges: [null, { offset: -1, length: 99, style: "Bold" }, { offset: 0, length: 99, style: "constructor" }], entityRanges: [{ key: 0, offset: 0, length: 99 }] },
    { type: "unknown-block", text: "Kept" }
  ], { entityMap: { "0": { type: "LINK", data: { url: "javascript:alert(1)" } } } });
  assert.equal(document.querySelectorAll("script, a, constructor").length, 0);
  assert.equal(document.body.textContent, "<script>😃 safeKept");
  assert.match(twitterArticleHtml({ content_state: { blocks: [] } }, "Fallback"), /Fallback/);
});
