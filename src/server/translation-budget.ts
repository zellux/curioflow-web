import { estimateLlmTextTokens, llmInputTokenBudget } from "./llm-input-budget.ts";
import type { TranslationUnit } from "./translation-content.ts";

const MAX_TRANSLATION_OUTPUT_TOKENS = 16_384;
const TRANSLATION_PROMPT_TOKENS = 768;

export function translationOutputTokens(units: TranslationUnit[]) {
  const characters = units.reduce((total, unit) => total + unit.text.length, 0);
  const envelope = units.map(unit => ({ id: unit.id, text: "" }));
  // Allow expansion into CJK text as well as JSON escaping and segment IDs.
  return characters * 2 + estimateLlmTextTokens(JSON.stringify(envelope)) * 2 + 512;
}

export function translationBudget(contextWindow: number, reasoningTokens: number) {
  const available = llmInputTokenBudget(contextWindow, reasoningTokens);
  const maxCharacters = Math.min(
    Math.floor((MAX_TRANSLATION_OUTPUT_TOKENS - 1024) / 2),
    Math.floor((available - TRANSLATION_PROMPT_TOKENS - 768) / 3)
  );
  if (maxCharacters < 32) throw new Error("The context limit is too small for article translation. Increase it in Settings.");
  return {
    maxCharacters,
    fits: (units: TranslationUnit[]) => {
      const outputTokens = translationOutputTokens(units);
      return outputTokens <= MAX_TRANSLATION_OUTPUT_TOKENS
        && estimateLlmTextTokens(JSON.stringify(units)) + TRANSLATION_PROMPT_TOKENS + outputTokens <= available;
    }
  };
}
