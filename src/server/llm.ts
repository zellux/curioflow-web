import { fetchJsonWithPolicy, llmAllowsPrivateNetwork } from "@/server/outbound-http";

const LLM_TIMEOUT_MS = 60_000;
const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;
// Reasoning models count internal thinking toward the completion limit.
const REASONING_TOKEN_RESERVE = 4_096;

type RuntimeLlmSettings = {
  apiKey: string | null;
  baseUrl: string;
  enabled?: boolean;
  model: string;
  provider: string;
};

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function describeEmptyCompletion(
  finishReason: unknown,
  usage: { completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } } | undefined
) {
  const details = [
    typeof finishReason === "string" ? `finish_reason: ${finishReason}` : null,
    typeof usage?.completion_tokens_details?.reasoning_tokens === "number"
      ? `reasoning tokens: ${usage.completion_tokens_details.reasoning_tokens}${typeof usage.completion_tokens === "number" ? ` of ${usage.completion_tokens} completion tokens` : ""}`
      : null
  ].filter(Boolean);
  if (finishReason === "length") details.push("the completion token limit was used up before any visible text");
  return details.length ? ` (${details.join("; ")})` : "";
}

export function canCallTextLlm(settings: RuntimeLlmSettings) {
  return settings.enabled !== false && (settings.provider === "local" || Boolean(settings.apiKey));
}

export async function completeTextWithLlm(
  settings: RuntimeLlmSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: { maxTokens?: number; temperature?: number; requireComplete?: boolean } = {}
) {
  if (!canCallTextLlm(settings)) {
    throw new Error(settings.enabled === false
      ? "LLM features are disabled in Settings."
      : "Add an LLM API key in Settings before generating summaries.");
  }
  const allowPrivateNetwork = await llmAllowsPrivateNetwork(settings.provider, settings.baseUrl);

  if (settings.provider === "anthropic") {
    const usesAdaptiveThinking = /^claude-(?:(?:opus|sonnet|haiku)-5-5|fable-5-1)(?:-|$)/.test(settings.model);
    const [systemMessage, ...conversation] = messages;
    const body = await fetchJsonWithPolicy<{ stop_reason?: string; content?: Array<{ text?: unknown; type?: string }> }>(llmEndpoint(settings.baseUrl, "/messages"), {
      allowPrivateNetwork,
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {})
      },
      body: JSON.stringify({
        max_tokens: (options.maxTokens ?? 700) + (usesAdaptiveThinking ? REASONING_TOKEN_RESERVE : 0),
        messages: conversation.map((message) => ({ role: message.role === "system" ? "user" : message.role, content: message.content })),
        model: settings.model,
        system: systemMessage?.role === "system" ? systemMessage.content : undefined,
        ...(usesAdaptiveThinking
          ? { output_config: { effort: "low" } }
          : { temperature: options.temperature ?? 0.2 })
      }),
      maxBytes: MAX_LLM_RESPONSE_BYTES,
      timeoutMs: LLM_TIMEOUT_MS
    });
    if (options.requireComplete && body.stop_reason === "max_tokens") throw new Error("LLM translation response was truncated.");
    const textPart = body.content?.find((part): part is { text: string; type?: string } => part.type === "text" && typeof part.text === "string");
    const text = textPart?.text;
    if (!text) throw new Error("LLM response did not include text.");
    return text.trim();
  }

  const usesGpt6 = settings.provider === "openai" && /^gpt-6(?:[.-]|$)/.test(settings.model);
  const usesOpenRouterReasoning = settings.provider === "openrouter"
    && /^(?:z-ai\/glm-5\.3(?:-flash)?|deepseek\/deepseek-v4\.1-flash|xiaomi\/mimo-v2\.6-flash)$/.test(settings.model);
  const body = await fetchJsonWithPolicy<{
    choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
    usage?: { completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } };
  }>(llmEndpoint(settings.baseUrl, "/chat/completions"), {
    allowPrivateNetwork,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      ...(settings.provider === "meta" || usesGpt6 ? {
        max_completion_tokens: (options.maxTokens ?? 700) + REASONING_TOKEN_RESERVE,
        reasoning_effort: usesGpt6 ? "low" : "minimal"
      } : {
        max_tokens: (options.maxTokens ?? 700) + (usesOpenRouterReasoning ? REASONING_TOKEN_RESERVE : 0),
        ...(usesOpenRouterReasoning ? { reasoning: { effort: "low" } } : {})
      }),
      messages,
      model: settings.model,
      ...(!usesGpt6 ? { temperature: options.temperature ?? (settings.provider === "meta" ? 1 : 0.2) } : {})
    }),
    maxBytes: MAX_LLM_RESPONSE_BYTES,
    timeoutMs: LLM_TIMEOUT_MS
  });
  const choice = body.choices?.[0];
  if (options.requireComplete && choice?.finish_reason === "length") throw new Error("LLM translation response was truncated.");
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`LLM response did not include text.${describeEmptyCompletion(choice?.finish_reason, body.usage)}`);
  }

  return text.trim();
}
