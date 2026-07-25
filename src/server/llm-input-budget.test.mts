import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateLlmTextTokens,
  summaryArticleTextForContextWindow,
  truncateTextToEstimatedTokens
} from "./llm-input-budget.ts";

test("token estimate treats CJK text more conservatively than Latin text", () => {
  assert.ok(estimateLlmTextTokens("这是中文测试文本") > estimateLlmTextTokens("abcdefgh"));
});

test("text truncation stays within the estimated token budget", () => {
  const input = `${"English words ".repeat(1000)}${"中文".repeat(1000)}`;
  const truncated = truncateTextToEstimatedTokens(input, 500);
  assert.ok(truncated.length < input.length);
  assert.ok(estimateLlmTextTokens(truncated) <= 500);
});

test("summary input uses the detected context window while retaining the legacy fallback", () => {
  const input = "word ".repeat(10_000);
  assert.equal(summaryArticleTextForContextWindow(input, null).length, 32000);

  const bounded = summaryArticleTextForContextWindow(input, 8192);
  assert.ok(bounded.length < 32000);
  assert.ok(estimateLlmTextTokens(bounded) <= Math.floor((8192 - 1600) * 0.9));
});
