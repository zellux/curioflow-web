const DEFAULT_MAX_INPUT_CHARACTERS = 32_000;

function estimatedCharacterTokens(character: string) {
  if (/\s/u.test(character)) return 0.12;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)) return 1;
  if (/[\p{Letter}\p{Number}]/u.test(character)) return 0.25;
  return 0.5;
}

export function estimateLlmTextTokens(text: string) {
  let tokens = 0;
  for (const character of text) tokens += estimatedCharacterTokens(character);
  return Math.ceil(tokens);
}

export function truncateTextToEstimatedTokens(text: string, maxTokens: number) {
  if (maxTokens <= 0) return "";
  let estimatedTokens = 0;
  let end = 0;
  for (const character of text) {
    const nextEstimate = estimatedTokens + estimatedCharacterTokens(character);
    if (nextEstimate > maxTokens) break;
    estimatedTokens = nextEstimate;
    end += character.length;
  }
  return text.slice(0, end);
}

export function summaryArticleTextForContextWindow(
  articleText: string,
  contextWindow: number | null,
  options: {
    maxCharacters?: number;
    reservedTokens?: number;
  } = {}
) {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS;
  const candidate = articleText.slice(0, maxCharacters);
  if (!contextWindow) return candidate;

  // Reserve output, instructions, title/source metadata, and a safety margin for
  // tokenizer differences between providers.
  const reservedTokens = options.reservedTokens ?? 1_600;
  const articleTokenBudget = Math.floor((contextWindow - reservedTokens) * 0.9);
  if (articleTokenBudget < 256) {
    throw new Error(`The detected ${contextWindow}-token context window is too small for article summaries.`);
  }
  if (estimateLlmTextTokens(candidate) <= articleTokenBudget) return candidate;
  return truncateTextToEstimatedTokens(candidate, articleTokenBudget);
}
