import assert from "node:assert/strict";
import test from "node:test";
import { effectiveContextWindow, modelContextWindowPreset, parseContextWindowLimit } from "../llm-context.ts";
import { buildAskMessages } from "./chat-context.ts";
import { libraryAgentSystemPrompt } from "./chat-agent-prompt.ts";
import { estimateLlmMessageTokens, llmInputTokenBudget } from "./llm-input-budget.ts";
import { translationBudget, translationOutputTokens } from "./translation-budget.ts";
import { assembleTranslation, createTranslationPlan } from "./translation-content.ts";

test("context overrides validate and respect serving capacity, including smaller local windows", () => {
  assert.equal(parseContextWindowLimit(""), null);
  assert.equal(parseContextWindowLimit(undefined), undefined);
  assert.equal(parseContextWindowLimit("32768"), 32768);
  for (const value of [0, -1, 2047, 8192.5, NaN, Infinity, "no", 10_000_001]) assert.throws(() => parseContextWindowLimit(value));
  assert.equal(effectiveContextWindow(8192, 32768, 131072), 8192);
  assert.equal(effectiveContextWindow(null, 32768), 32768);
  assert.equal(effectiveContextWindow(null, null, 131072), 131072);
  assert.equal(effectiveContextWindow(null, null), 16384);
  assert.equal(modelContextWindowPreset("local", "llama3.1"), null);
  assert.equal(modelContextWindowPreset("openrouter", "minimax/minimax-m3"), 524288);
  assert.equal(modelContextWindowPreset("openai", "unknown"), null);
});

test("Ask keeps long articles and more than six messages when the selected budget permits", () => {
  const article = "Full article passage. ".repeat(1500);
  const conversation = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Message ${index}` }));
  const messages = buildAskMessages({ system: libraryAgentSystemPrompt("item-1"), question: "Explain the ending", conversation,
    observations: [{ tool: "read_item", result: { itemId: "item-1", content: article } }], contextWindow: 128000, reservedTokens: 4996 });
  assert.ok(messages[1].content.includes(article));
  for (const message of conversation) assert.ok(messages[1].content.includes(message.content));
});

test("Ask bounds accumulated CJK evidence and history without corrupting JSON or dropping the question and IDs", () => {
  const observations = Array.from({ length: 5 }, (_, index) => ({ tool: "read_item", result: { itemId: `item-${index}`, content: '中文证据\\"😀'.repeat(6000), nextOffset: 20000 } }));
  const source = structuredClone(observations);
  const messages = buildAskMessages({ system: libraryAgentSystemPrompt(), question: "比较这些文章", conversation: [{ role: "user", content: "old message ".repeat(5000) }],
    observations, contextWindow: 8192, reservedTokens: 4996 });
  assert.ok(estimateLlmMessageTokens(messages) <= llmInputTokenBudget(8192, 4996));
  assert.ok(messages[1].content.includes("比较这些文章"));
  const json = messages[1].content.split("Tool observations:\n")[1].split("\n\nChoose the next")[0];
  const evidence = JSON.parse(json);
  assert.equal(evidence.at(-1).result.itemId, "item-4");
  assert.equal(evidence.at(-1).result.nextOffset, 20000);
  assert.match(evidence.at(-1).result.content, /truncated/);
  assert.deepEqual(observations, source);
  assert.throws(() => buildAskMessages({ system: "System", question: "中文".repeat(10000), conversation: [], observations: [], contextWindow: 8192, reservedTokens: 4996 }), /question/);
});

test("translation batching scales with context, removes the 20-node cap, and preserves every source character", () => {
  const text = "English paragraph. 中文段落😀 ".repeat(1000);
  const largeBudget = translationBudget(128000, 4096);
  const smallBudget = translationBudget(8192, 4096);
  const large = createTranslationPlan("Title", null, text, largeBudget.maxCharacters, largeBudget.fits);
  const small = createTranslationPlan("Title", null, text, smallBudget.maxCharacters, smallBudget.fits);
  assert.ok(large.chunks.length < small.chunks.length);
  for (const [plan, budget, window] of [[large, largeBudget, 128000], [small, smallBudget, 8192]] as const) {
    assert.ok(plan.chunks.every(chunk => budget.fits(chunk)));
    for (const chunk of plan.chunks) assert.ok(translationOutputTokens(chunk) + 4096 < window);
    assert.equal(assembleTranslation(plan, plan.chunks).articleHtml, `<p>${text}</p>`);
  }
  const inline = createTranslationPlan("Title", `<p>${"word <strong>bold</strong> ".repeat(30)}</p>`, "", largeBudget.maxCharacters, largeBudget.fits);
  assert.equal(inline.chunks.length, 1);
  assert.ok(inline.chunks[0].length > 20);
});
