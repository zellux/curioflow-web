import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentUser } from "@/server/auth";
import { completeTextWithLlm } from "@/server/llm";
import { getLlmRuntimeSettingsForAccount } from "@/server/settings";

const PROVIDERS = new Set(["anthropic", "local", "openai", "openrouter"]);
const LLM_TEST_MAX_TOKENS = 128;

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

  try {
    const user = await requireCurrentUser();
    const savedSettings = await getLlmRuntimeSettingsForAccount(user.accountId);
    const settings = {
      enabled: savedSettings.enabled,
      provider: provider(body?.provider) || savedSettings.provider,
      baseUrl: text(body?.baseUrl) || savedSettings.baseUrl,
      model: text(body?.model) || savedSettings.model,
      apiKey: text(body?.apiKey) || savedSettings.apiKey
    };
    const response = await completeTextWithLlm(
      settings,
      [
        { role: "system", content: "Reply with exactly: Curioflow LLM test OK" },
        { role: "user", content: "Test the connection." }
      ],
      { maxTokens: LLM_TEST_MAX_TOKENS, temperature: 0 }
    );

    return NextResponse.json({ ok: true, response });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to test this LLM endpoint" });
  }
}
