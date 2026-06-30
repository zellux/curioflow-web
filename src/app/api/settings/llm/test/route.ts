import { NextResponse } from "next/server";
import { completeTextWithLlm } from "@/server/llm";
import { getLlmRuntimeSettingsForCurrentAccount } from "@/server/settings";

const PROVIDERS = new Set(["anthropic", "local", "openai", "openrouter"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function provider(value: unknown) {
  const candidate = text(value);
  return PROVIDERS.has(candidate) ? candidate : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    provider?: unknown;
  } | null;

  const savedSettings = await getLlmRuntimeSettingsForCurrentAccount();
  const settings = {
    provider: provider(body?.provider) || savedSettings.provider,
    baseUrl: text(body?.baseUrl) || savedSettings.baseUrl,
    model: text(body?.model) || savedSettings.model,
    apiKey: text(body?.apiKey) || savedSettings.apiKey
  };

  try {
    const response = await completeTextWithLlm(
      settings,
      [
        { role: "system", content: "Reply with exactly: Curioflow LLM test OK" },
        { role: "user", content: "Test the connection." }
      ],
      { maxTokens: 24, temperature: 0 }
    );

    return NextResponse.json({ ok: true, response });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to test this LLM endpoint" },
      { status: 400 }
    );
  }
}
