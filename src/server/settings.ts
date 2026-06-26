import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth";

const DEFAULT_LLM_SETTINGS = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini"
};

export async function getLlmSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  const settings = await prisma.llmSetting.findUnique({
    where: { accountId: user.accountId }
  });

  if (!settings) {
    return {
      ...DEFAULT_LLM_SETTINGS,
      hasApiKey: false,
      updatedAt: null
    };
  }

  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl ?? DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings.model,
    hasApiKey: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export async function getLlmRuntimeSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  const settings = await prisma.llmSetting.findUnique({
    where: { accountId: user.accountId }
  });

  return {
    provider: settings?.provider ?? DEFAULT_LLM_SETTINGS.provider,
    baseUrl: settings?.baseUrl ?? DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings?.model ?? DEFAULT_LLM_SETTINGS.model,
    apiKey: settings?.apiKey ?? null
  };
}

export async function upsertLlmSettingsForCurrentAccount(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const user = await getCurrentUser();
  const provider = input.provider.trim() || DEFAULT_LLM_SETTINGS.provider;
  const baseUrl = input.baseUrl.trim() || DEFAULT_LLM_SETTINGS.baseUrl;
  const model = input.model.trim() || DEFAULT_LLM_SETTINGS.model;
  const apiKey = input.apiKey?.trim();

  return prisma.llmSetting.upsert({
    where: { accountId: user.accountId },
    update: {
      provider,
      baseUrl,
      model,
      ...(apiKey ? { apiKey } : {})
    },
    create: {
      accountId: user.accountId,
      provider,
      baseUrl,
      model,
      apiKey: apiKey || null
    }
  });
}
