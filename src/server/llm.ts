import { fetchJsonWithPolicy, llmAllowsPrivateNetwork } from "@/server/outbound-http";

const LLM_TIMEOUT_MS = 60_000;
const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;

type RuntimeLlmSettings = {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  provider: string;
};

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function canCallTextLlm(settings: RuntimeLlmSettings) {
  return settings.provider === "local" || Boolean(settings.apiKey);
}

export async function completeTextWithLlm(
  settings: RuntimeLlmSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: { maxTokens?: number; temperature?: number } = {}
) {
  if (!canCallTextLlm(settings)) {
    throw new Error("Add an LLM API key in Settings before generating summaries.");
  }
  const allowPrivateNetwork = await llmAllowsPrivateNetwork(settings.provider, settings.baseUrl);

  if (settings.provider === "anthropic") {
    const [systemMessage, ...conversation] = messages;
    const body = await fetchJsonWithPolicy<{ content?: Array<{ text?: unknown; type?: string }> }>(llmEndpoint(settings.baseUrl, "/messages"), {
      allowPrivateNetwork,
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {})
      },
      body: JSON.stringify({
        max_tokens: options.maxTokens ?? 700,
        messages: conversation.map((message) => ({ role: message.role === "system" ? "user" : message.role, content: message.content })),
        model: settings.model,
        system: systemMessage?.role === "system" ? systemMessage.content : undefined,
        temperature: options.temperature ?? 0.2
      }),
      maxBytes: MAX_LLM_RESPONSE_BYTES,
      timeoutMs: LLM_TIMEOUT_MS
    });
    const textPart = body.content?.find((part): part is { text: string; type?: string } => part.type === "text" && typeof part.text === "string");
    const text = textPart?.text;
    if (!text) throw new Error("LLM response did not include text.");
    return text.trim();
  }

  const body = await fetchJsonWithPolicy<{
    choices?: Array<{ message?: { content?: unknown } }>;
  }>(llmEndpoint(settings.baseUrl, "/chat/completions"), {
    allowPrivateNetwork,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      max_tokens: options.maxTokens ?? 700,
      messages,
      model: settings.model,
      temperature: options.temperature ?? 0.2
    }),
    maxBytes: MAX_LLM_RESPONSE_BYTES,
    timeoutMs: LLM_TIMEOUT_MS
  });
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("LLM response did not include text.");
  }

  return text.trim();
}
