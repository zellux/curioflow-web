export const JOB_FAILURE_CATEGORIES = {
  ENTITLEMENT: "entitlement",
  NETWORK: "network",
  PARSER: "parser",
  PROVIDER: "provider",
  RETRY: "retry",
  TIMEOUT: "timeout",
  UNKNOWN: "unknown"
} as const;

export type JobFailureCategory = typeof JOB_FAILURE_CATEGORIES[keyof typeof JOB_FAILURE_CATEGORIES];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyJobFailure(error: unknown): JobFailureCategory {
  const message = errorText(error).toLowerCase();

  if (/\b(maximum retry|maximum attempt|max attempts|exhausted)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.RETRY;
  }

  if (/\b(entitlement|limit|quota|forbidden|unauthorized|not allowed|plan)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.ENTITLEMENT;
  }

  if (/\b(timeout|timed out|abort|aborted|etimedout)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.TIMEOUT;
  }

  if (/\b(llm|openai|anthropic|provider|transcription|analysis|completion|api key)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.PROVIDER;
  }

  if (/\b(fetch|network|dns|enotfound|econn|socket|http|url|audio)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.NETWORK;
  }

  if (/\b(parse|parser|pdf|xml|rss|atom|readability|extractable|extraction)\b/.test(message)) {
    return JOB_FAILURE_CATEGORIES.PARSER;
  }

  return JOB_FAILURE_CATEGORIES.UNKNOWN;
}
