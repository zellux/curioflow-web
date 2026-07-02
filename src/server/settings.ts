import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { openSecret, sealSecret } from "@/server/secrets";

const DEFAULT_LLM_SETTINGS = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  systemLanguage: "en",
  summaryLanguage: "en"
};

const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  local: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1"
};

function normalizeLanguage(value: string | null | undefined) {
  return value === "zh-Hans" ? "zh-Hans" : "en";
}

function normalizeSummaryLanguage(value: string | null | undefined) {
  return value === "zh-Hans" || value === "article" ? value : "en";
}

export async function getLlmSettingsForAccount(accountId: string) {
  const settings = await prisma.llmSetting.findUnique({
    where: { accountId }
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
    baseUrl: settings.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[settings.provider] ?? DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings.model,
    systemLanguage: normalizeLanguage(settings.systemLanguage),
    summaryLanguage: normalizeSummaryLanguage(settings.summaryLanguage),
    hasApiKey: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export async function getLlmSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  return getLlmSettingsForAccount(user.accountId);
}

export async function getLlmRuntimeSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  const settings = await prisma.llmSetting.findUnique({
    where: { accountId: user.accountId }
  });

  return {
    provider: settings?.provider ?? DEFAULT_LLM_SETTINGS.provider,
    baseUrl: settings?.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[settings?.provider ?? ""] ?? DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings?.model ?? DEFAULT_LLM_SETTINGS.model,
    systemLanguage: normalizeLanguage(settings?.systemLanguage),
    summaryLanguage: normalizeSummaryLanguage(settings?.summaryLanguage),
    apiKey: openSecret(settings?.apiKey)
  };
}

export async function upsertLlmSettingsForCurrentAccount(input: {
  provider: string;
  baseUrl: string;
  model: string;
  systemLanguage?: string;
  summaryLanguage?: string;
  apiKey?: string;
}) {
  const user = await getCurrentUser();
  const provider = input.provider.trim() || DEFAULT_LLM_SETTINGS.provider;
  const baseUrl = input.baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[provider] || DEFAULT_LLM_SETTINGS.baseUrl;
  const model = input.model.trim() || DEFAULT_LLM_SETTINGS.model;
  const systemLanguage = normalizeLanguage(input.systemLanguage);
  const summaryLanguage = normalizeSummaryLanguage(input.summaryLanguage);
  const apiKey = input.apiKey?.trim();
  const storedApiKey = apiKey ? sealSecret(apiKey) : null;

  return prisma.llmSetting.upsert({
    where: { accountId: user.accountId },
    update: {
      provider,
      baseUrl,
      model,
      systemLanguage,
      summaryLanguage,
      ...(storedApiKey ? { apiKey: storedApiKey } : {})
    },
    create: {
      accountId: user.accountId,
      provider,
      baseUrl,
      model,
      systemLanguage,
      summaryLanguage,
      apiKey: storedApiKey
    }
  });
}
