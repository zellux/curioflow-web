import assert from "node:assert/strict";
import test from "node:test";
import { readingLanguage, snippetReadingLanguage } from "../app/reader-language.ts";

test("snippetReadingLanguage detects short Chinese highlights, notes, and titles", () => {
  assert.equal(snippetReadingLanguage("original", "“我们并不缺少信息”"), "zh-CN");
  assert.equal(snippetReadingLanguage("article", "“稍后读”之所以读不完"), "zh-CN");
  assert.equal(snippetReadingLanguage("zh-Hans", "慢下来读"), "zh-Hans");
  assert.equal(snippetReadingLanguage("zh-Hant", "慢下來讀"), "zh-Hant");
  assert.equal(snippetReadingLanguage(null, "用 SQLite 做本地优先同步：一次 WAL 模式的踩坑记录"), "zh-CN");
  assert.equal(snippetReadingLanguage(null, "AI 趋势"), "zh-CN");
  assert.equal(snippetReadingLanguage(null, "好"), "zh-CN");
});

test("snippetReadingLanguage preserves English and other scripts without false zh matches", () => {
  assert.equal(snippetReadingLanguage("original", "Every serious reader eventually discovers the margin."), "en");
  assert.equal(snippetReadingLanguage("article", "Calm software earns trust by staying out of the way."), "en");
  assert.equal(snippetReadingLanguage("zh-Hans", "A note written in English"), "en");
  assert.equal(snippetReadingLanguage(null, "English text mentioning “慢下来读” as an example."), "en");
  assert.equal(snippetReadingLanguage("original", "日本語のハイライト"), "ja");
  assert.equal(snippetReadingLanguage("original", "하이라이트 메모"), "ko");
  assert.equal(snippetReadingLanguage("fr", "Bonjour le monde"), "fr");
  assert.equal(snippetReadingLanguage("zh-Hans", ""), "zh-Hans");
});

test("readingLanguage keeps article-length threshold behavior", () => {
  assert.equal(
    readingLanguage("en", "我们并不缺少信息，我们缺少的是把信息变成理解的那段安静时间。收集可以很快，但理解需要时间。"),
    "zh-CN"
  );
  assert.equal(readingLanguage("en", "A short English sentence mentioning 慢下来读."), "en");
});
