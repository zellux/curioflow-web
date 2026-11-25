import assert from "node:assert/strict";
import test from "node:test";
import { getUiCopy, normalizeSummaryLanguage, normalizeSystemLanguage, SYSTEM_LANGUAGES } from "@/app/i18n";
import { displayLanguageForSummary, readLlmSummaryFromMetadata } from "./summary-metadata.ts";

const metadata = JSON.stringify({
  summary: { overview: "Private summary", points: ["One"] },
  summaryAccountId: "account-a",
  summaryLanguage: "en",
  summarySource: "llm",
  summaryStatus: "succeeded"
});

test("account-owned summaries are hidden from other accounts", () => {
  assert.equal(readLlmSummaryFromMetadata(metadata, "account-b"), null);
  assert.equal(readLlmSummaryFromMetadata(metadata, "account-a")?.overview, "Private summary");
});

test("system and summary languages normalize supported locales and fall back to en", () => {
  for (const lang of SYSTEM_LANGUAGES) {
    assert.equal(normalizeSystemLanguage(lang), lang);
    assert.equal(normalizeSummaryLanguage(lang), lang);
    assert.equal(getUiCopy(lang).locale, lang);
  }
  assert.equal(normalizeSummaryLanguage("article"), "article");
  assert.equal(normalizeSystemLanguage("unknown"), "en");
  assert.equal(normalizeSummaryLanguage("unknown"), "en");
});

test("displayLanguageForSummary preserves explicit locales and infers scripts", () => {
  assert.equal(displayLanguageForSummary({ language: "zh-Hant", overview: "繁體摘要", points: [] }), "zh-Hant");
  assert.equal(displayLanguageForSummary({ language: "ja", overview: "日本語の要約", points: [] }), "ja");
  assert.equal(displayLanguageForSummary({ language: "ko", overview: "한국어 요약", points: [] }), "ko");
  assert.equal(displayLanguageForSummary({ language: null, overview: "日本語の要約です。", points: [] }), "ja");
  assert.equal(displayLanguageForSummary({ language: null, overview: "한국어 요약입니다.", points: [] }), "ko");
  assert.equal(displayLanguageForSummary({ language: null, overview: "中文摘要。", points: [] }), "zh-Hans");
  assert.equal(displayLanguageForSummary({ language: null, overview: "English summary.", points: [] }), "en");
});
