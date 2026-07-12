import { NextResponse } from "next/server";
import { AuthRequiredError } from "@/server/auth";
import { EntitlementDeniedError } from "@/server/entitlements";
import { getMobileContext } from "@/server/mobile";
import { getLlmSettingsForAccount, upsertLlmSettingsForAccount } from "@/server/settings";

function llmSettingsErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof EntitlementDeniedError) {
    return NextResponse.json({ code: error.code, message: error.message, retryable: false }, { status: error.status });
  }

  throw error;
}

export async function GET() {
  try {
    const { user } = await getMobileContext();
    const settings = await getLlmSettingsForAccount(user.accountId);
    return NextResponse.json({ settings });
  } catch (error) {
    return llmSettingsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    provider?: string;
    baseUrl?: string;
    model?: string;
    askModel?: string;
    systemLanguage?: string;
    summaryLanguage?: string;
    summaryConcurrency?: number | string;
    apiKey?: string;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "settings are required" }, { status: 400 });
  }

  try {
    const { user } = await getMobileContext();
    const saved = await upsertLlmSettingsForAccount(user.accountId, {
      provider: body.provider ?? "",
      baseUrl: body.baseUrl ?? "",
      model: body.model ?? "",
      askModel: body.askModel,
      systemLanguage: body.systemLanguage,
      summaryLanguage: body.summaryLanguage,
      summaryConcurrency: body.summaryConcurrency,
      apiKey: body.apiKey
    });
    const settings = await getLlmSettingsForAccount(saved.accountId);
    return NextResponse.json({ settings });
  } catch (error) {
    return llmSettingsErrorResponse(error);
  }
}
