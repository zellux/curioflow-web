// Published capacities checked 2026-11-02. Provider metadata takes precedence.
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://dev.meta.ai/docs/models
// https://openrouter.ai/api/v1/models (top_provider.context_length)
export function modelContextWindowPreset(provider: string, model: string): number | null {
  const id = model.trim().toLowerCase();
  if (provider === "openai") {
    if (/^gpt-6(?:\.1)?-(astra|sol|luna|terra)(?:-|$)/.test(id)) return 1_050_000;
    if (/^gpt-5\.4-(mini|nano)(?:-|$)/.test(id)) return 400_000;
    if (/^gpt-5\.[456](?:-|$)/.test(id)) return 1_050_000;
    if (/^gpt-4\.1(?:-|$)/.test(id)) return 1_047_576;
    if (/^gpt-4o(?:-|$)/.test(id)) return 128_000;
    if (/^(o3|o4-mini)(?:-|$)/.test(id)) return 200_000;
  }
  if (provider === "anthropic" && /^claude-(?:(?:opus|sonnet|haiku)-5-5|fable-5-1)(?:-|$)/.test(id)) return 1_000_000;
  if (provider === "meta" && (/^muse-spark-1\.(?:1|[23](?:-contributor)?)$/.test(id) || id === "muse-wonder-1.0")) return 1_048_576;
  if (provider === "openrouter") {
    const windows: Record<string, number> = {
      "z-ai/glm-5.3": 1_048_576,
      "z-ai/glm-5.3-flash": 1_048_576,
      "deepseek/deepseek-v4.1-flash": 1_048_576,
      "xiaomi/mimo-v2.6-flash": 1_048_576,
      "minimax/minimax-m3": 524_288,
      "nvidia/nemotron-3-ultra-550b-a55b:free": 1_000_000,
      "openai/gpt-oss-120b": 131_072
    };
    return windows[id] ?? (id.startsWith("openai/") ? modelContextWindowPreset("openai", id.slice(7)) : null);
  }
  // Local endpoints must use the loaded context size, not the model's maximum.
  return null;
}

export class ContextWindowValidationError extends Error {}

export function parseContextWindowLimit(value: number | string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const limit = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(limit) || limit < 2048 || limit > 10_000_000) {
    throw new ContextWindowValidationError("Context limit must be a whole number between 2,048 and 10,000,000 tokens, or empty for automatic.");
  }
  return limit;
}

export function effectiveContextWindow(detected: number | null, limit: number | null, preset: number | null = null) {
  const capacity = detected ?? preset;
  return limit ? Math.min(limit, capacity ?? limit) : capacity ?? 16_384;
}
