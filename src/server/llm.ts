type RuntimeLlmSettings = {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  provider: string;
};

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function llmHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-base-url";
  }
}

async function llmHttpError(response: Response, settings: RuntimeLlmSettings) {
  const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
  return new Error(
    `LLM request failed with HTTP ${response.status} (${settings.provider}/${settings.model} at ${llmHost(settings.baseUrl)})${body ? `: ${body}` : ""}`
  );
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

  if (settings.provider === "anthropic") {
    const [systemMessage, ...conversation] = messages;
    const response = await fetch(llmEndpoint(settings.baseUrl, "/messages"), {
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
      })
    });

    if (!response.ok) {
      throw await llmHttpError(response, settings);
    }

    const body = (await response.json()) as { content?: Array<{ text?: unknown; type?: string }> };
    const textPart = body.content?.find((part): part is { text: string; type?: string } => part.type === "text" && typeof part.text === "string");
    const text = textPart?.text;
    if (!text) throw new Error("LLM response did not include text.");
    return text.trim();
  }

  const response = await fetch(llmEndpoint(settings.baseUrl, "/chat/completions"), {
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
    })
  });

  if (!response.ok) {
    throw await llmHttpError(response, settings);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("LLM response did not include text.");
  }

  return text.trim();
}
