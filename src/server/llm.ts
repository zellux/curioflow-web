import { fetchJsonWithPolicy, llmAllowsPrivateNetwork, OutboundHttpError } from "@/server/outbound-http";

const LLM_TIMEOUT_MS = 60_000;
const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;
// Reasoning models count internal thinking toward the completion limit.
const REASONING_TOKEN_RESERVE = 4_096;

const ANTHROPIC_ADAPTIVE_THINKING_RE = /^claude-(?:(?:opus|sonnet|haiku)-5-5|fable-5-1)(?:-|$)/;
const ANTHROPIC_BETWEEN_TOOLS_ONLY_RE = /^claude-sonnet-5-5(?:-|$)/;
const OPENAI_GPT6_RE = /^gpt-6(?:[.-]|$)/;
const OPENAI_GPT6_SUPPORTS_NONE_RE = /^gpt-6-luna(?:-|$)/;
// Verified via OpenRouter /api/v1/models: GLM 5.3 variants enforce mandatory reasoning (lowest effort: "low").
const OPENROUTER_MANDATORY_REASONING_RE = /^z-ai\/glm-5\.3(?:$|[.-]|:[a-z0-9-]+$)/i;
const OPENROUTER_REASONING_PRESET_RE = /^(?:z-ai\/glm-(?:4\.[5-9]|5)(?:[.-]|$)|deepseek\/deepseek-v4\.1-flash|xiaomi\/mimo-v2\.6-flash)/i;

export type LlmReasoningMode = "default" | "none";

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

export function llmReasoningTokenReserve(
  settings: Pick<RuntimeLlmSettings, "provider" | "model">,
  mode: LlmReasoningMode = "default"
) {
  if (settings.provider === "meta") return REASONING_TOKEN_RESERVE;
  if (settings.provider === "openai" && OPENAI_GPT6_RE.test(settings.model)) {
    return mode === "none" && OPENAI_GPT6_SUPPORTS_NONE_RE.test(settings.model) ? 0 : REASONING_TOKEN_RESERVE;
  }
  if (settings.provider === "anthropic" && ANTHROPIC_ADAPTIVE_THINKING_RE.test(settings.model)) {
    return mode === "none" ? 0 : REASONING_TOKEN_RESERVE;
  }
  if (settings.provider === "openrouter" && OPENROUTER_REASONING_PRESET_RE.test(settings.model)) {
    return mode === "none" && !OPENROUTER_MANDATORY_REASONING_RE.test(settings.model) ? 0 : REASONING_TOKEN_RESERVE;
  }
  return 0;
}

export async function completeTextWithLlm(
  settings: RuntimeLlmSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: { maxTokens?: number; temperature?: number; requireComplete?: boolean; reasoning?: LlmReasoningMode; preferFastProvider?: boolean } = {}
) {
  if (!canCallTextLlm(settings)) {
    throw new Error(settings.enabled === false
      ? "LLM features are disabled in Settings."
      : "Add an LLM API key in Settings before generating summaries.");
  }
  const allowPrivateNetwork = await llmAllowsPrivateNetwork(settings.provider, settings.baseUrl);
  const reasoningMode = options.reasoning ?? "default";
  const reasoningReserve = llmReasoningTokenReserve(settings, reasoningMode);

  if (settings.provider === "anthropic") {
    const usesAdaptiveThinking = ANTHROPIC_ADAPTIVE_THINKING_RE.test(settings.model);
    const anthropicThinking = !usesAdaptiveThinking
      ? { temperature: options.temperature ?? 0.2 }
      : reasoningMode === "none"
        ? (ANTHROPIC_BETWEEN_TOOLS_ONLY_RE.test(settings.model)
          ? { thinking: { type: "between_tools" }, output_config: { effort: "low" } }
          : { thinking: { type: "disabled" } })
        : { output_config: { effort: "low" } };
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
        max_tokens: (options.maxTokens ?? 700) + reasoningReserve,
        messages: conversation.map((message) => ({ role: message.role === "system" ? "user" : message.role, content: message.content })),
        model: settings.model,
        system: systemMessage?.role === "system" ? systemMessage.content : undefined,
        ...anthropicThinking
      }),
      includeResponseBodyInErrors: true,
      maxBytes: MAX_LLM_RESPONSE_BYTES,
      timeoutMs: LLM_TIMEOUT_MS
    });
    if (options.requireComplete && body.stop_reason === "max_tokens") throw new Error("LLM translation response was truncated.");
    const textPart = body.content?.find((part): part is { text: string; type?: string } => part.type === "text" && typeof part.text === "string");
    const text = textPart?.text;
    if (!text) throw new Error("LLM response did not include text.");
    return text.trim();
  }

  const usesGpt6 = settings.provider === "openai" && OPENAI_GPT6_RE.test(settings.model);
  const gpt6ReasoningEffort = reasoningMode === "none" && OPENAI_GPT6_SUPPORTS_NONE_RE.test(settings.model) ? "none" : "low";
  const usesOpenRouterReasoning = settings.provider === "openrouter" && OPENROUTER_REASONING_PRESET_RE.test(settings.model);
  const openRouterDisablesReasoning = settings.provider === "openrouter"
    && reasoningMode === "none"
    && !OPENROUTER_MANDATORY_REASONING_RE.test(settings.model);
  const requestOpenAiCompatible = (openRouterReasoningOverride?: { reasoning: { effort: "low" }; reserve: number }) =>
    fetchJsonWithPolicy<{
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
          max_completion_tokens: (options.maxTokens ?? 700) + reasoningReserve,
          reasoning_effort: usesGpt6 ? gpt6ReasoningEffort : "minimal"
        } : {
          max_tokens: (options.maxTokens ?? 700) + (openRouterReasoningOverride ? openRouterReasoningOverride.reserve : reasoningReserve),
          ...(openRouterReasoningOverride
            ? { reasoning: openRouterReasoningOverride.reasoning }
            : openRouterDisablesReasoning
              ? { reasoning: { enabled: false } }
              : usesOpenRouterReasoning
                ? { reasoning: { effort: "low" } }
                : {})
        }),
        messages,
        model: settings.model,
        // OpenRouter otherwise routes by price; latency-sensitive callers ask for the fastest upstream.
        ...(settings.provider === "openrouter" && options.preferFastProvider ? { provider: { sort: "throughput" } } : {}),
        ...(!usesGpt6 ? { temperature: options.temperature ?? (settings.provider === "meta" ? 1 : 0.2) } : {})
      }),
      includeResponseBodyInErrors: true,
      maxBytes: MAX_LLM_RESPONSE_BYTES,
      timeoutMs: LLM_TIMEOUT_MS
    });

  let body;
  try {
    body = await requestOpenAiCompatible();
  } catch (error) {
    // Some OpenRouter models mark reasoning as mandatory and reject enabled: false with HTTP 400.
    if (
      openRouterDisablesReasoning
      && error instanceof OutboundHttpError
      && error.status === 400
      && /reason|think|effort/i.test(error.message)
    ) {
      body = await requestOpenAiCompatible({ reasoning: { effort: "low" }, reserve: REASONING_TOKEN_RESERVE });
    } else {
      throw error;
    }
  }
  const choice = body.choices?.[0];
  if (options.requireComplete && choice?.finish_reason === "length") throw new Error("LLM translation response was truncated.");
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`LLM response did not include text.${describeEmptyCompletion(choice?.finish_reason, body.usage)}`);
  }

  return text.trim();
}
