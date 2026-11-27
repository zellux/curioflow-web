import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReaderLanguagePreference,
  preferredReaderLanguage,
  READER_LANGUAGE_STORAGE_KEY,
  readReaderLanguagePreference,
  rememberReaderLanguageInState,
  resolveInitialReaderLanguage,
  saveReaderLanguagePreference
} from "../app/reader-language-preference.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

test("per-article language takes precedence over global fallback", () => {
  let state = parseReaderLanguagePreference(null);
  state = rememberReaderLanguageInState(state, "article-a", "zh-Hans");
  state = rememberReaderLanguageInState(state, "article-b", "ja");
  state = rememberReaderLanguageInState(state, "article-a", "original");

  // Reopening article-a remembers explicit switch back to original.
  assert.equal(preferredReaderLanguage(state, "article-a"), "original");
  // Reopening article-b keeps its own remembered translation even after article-a switched to original.
  assert.equal(preferredReaderLanguage(state, "article-b"), "ja");
  // Unseen article-c falls back to the latest global choice.
  assert.equal(preferredReaderLanguage(state, "article-c"), "original");
});

test("unseen articles fall back to the last globally selected language when ready", () => {
  const storage = memoryStorage();
  saveReaderLanguagePreference("article-a", "zh-Hans", storage);

  const loaded = readReaderLanguagePreference(storage);
  const preferredForNewArticle = preferredReaderLanguage(loaded, "article-b");
  assert.equal(preferredForNewArticle, "zh-Hans");
  assert.equal(resolveInitialReaderLanguage(preferredForNewArticle, ["zh-Hans", "ja"]), "zh-Hans");
  // When an article has no ready translation for the preferred language, display falls back to original
  // without mutating the remembered preference.
  assert.equal(resolveInitialReaderLanguage(preferredForNewArticle, ["ja"]), "original");
  assert.equal(resolveInitialReaderLanguage(preferredForNewArticle, []), "original");
  assert.equal(preferredReaderLanguage(readReaderLanguagePreference(storage), "article-c"), "zh-Hans");
});

test("remembered per-item map stays bounded in LRU order", () => {
  let state = parseReaderLanguagePreference(null);
  state = rememberReaderLanguageInState(state, "a", "zh-Hans", 2);
  state = rememberReaderLanguageInState(state, "b", "ja", 2);
  // Touching "a" makes "b" the oldest entry.
  state = rememberReaderLanguageInState(state, "a", "ko", 2);
  state = rememberReaderLanguageInState(state, "c", "en", 2);

  assert.deepEqual(state.byItem, { a: "ko", c: "en" });
  assert.equal(state.lastLanguage, "en");
});

test("stored preferences are parsed defensively and tolerate storage errors", () => {
  assert.deepEqual(parseReaderLanguagePreference("{invalid"), { lastLanguage: null, byItem: {} });
  assert.deepEqual(parseReaderLanguagePreference(JSON.stringify({
    lastLanguage: "  zh-Hans  ",
    byItem: { a: "ja", b: "", c: 123, "": "en" }
  })), {
    lastLanguage: "zh-Hans",
    byItem: { a: "ja" }
  });

  const brokenStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    }
  };
  assert.deepEqual(readReaderLanguagePreference(brokenStorage), { lastLanguage: null, byItem: {} });
  assert.deepEqual(saveReaderLanguagePreference("article-a", "zh-Hans", brokenStorage), {
    lastLanguage: "zh-Hans",
    byItem: { "article-a": "zh-Hans" }
  });

  const storage = memoryStorage({ [READER_LANGUAGE_STORAGE_KEY]: "[]" });
  assert.deepEqual(readReaderLanguagePreference(storage), { lastLanguage: null, byItem: {} });
});
