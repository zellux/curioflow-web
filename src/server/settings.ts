import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { openSecret, requireSecretEncryptionKeyForWrite, sealSecret } from "@/server/secrets";

const DEFAULT_LLM_SETTINGS = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  systemLanguage: "en",
  summaryLanguage: "en",
  summaryConcurrency: 1
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

export function normalizeSummaryConcurrency(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_SETTINGS.summaryConcurrency;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
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
    summaryConcurrency: normalizeSummaryConcurrency(settings.summaryConcurrency),
    hasApiKey: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export async function getLlmSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  return getLlmSettingsForAccount(user.accountId);
}

export async function getLlmRuntimeSettingsForAccount(accountId: string) {
  const settings = await prisma.llmSetting.findUnique({
    where: { accountId }
  });

  return {
    provider: settings?.provider ?? DEFAULT_LLM_SETTINGS.provider,
    baseUrl: settings?.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[settings?.provider ?? ""] ?? DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings?.model ?? DEFAULT_LLM_SETTINGS.model,
    systemLanguage: normalizeLanguage(settings?.systemLanguage),
    summaryLanguage: normalizeSummaryLanguage(settings?.summaryLanguage),
    summaryConcurrency: normalizeSummaryConcurrency(settings?.summaryConcurrency),
    apiKey: openSecret(settings?.apiKey)
  };
}

export async function getLlmRuntimeSettingsForCurrentAccount() {
  const user = await getCurrentUser();
  return getLlmRuntimeSettingsForAccount(user.accountId);
}

type LlmSettingsInput = {
  provider: string;
  baseUrl: string;
  model: string;
  systemLanguage?: string;
  summaryLanguage?: string;
  summaryConcurrency?: number | string;
  apiKey?: string;
};

export async function upsertLlmSettingsForAccount(accountId: string, input: LlmSettingsInput) {
  const provider = input.provider.trim() || DEFAULT_LLM_SETTINGS.provider;
  const baseUrl = input.baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[provider] || DEFAULT_LLM_SETTINGS.baseUrl;
  const model = input.model.trim() || DEFAULT_LLM_SETTINGS.model;
  const systemLanguage = normalizeLanguage(input.systemLanguage);
  const summaryLanguage = normalizeSummaryLanguage(input.summaryLanguage);
  const summaryConcurrency = normalizeSummaryConcurrency(input.summaryConcurrency);
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    requireSecretEncryptionKeyForWrite();
  }
  const storedApiKey = apiKey ? sealSecret(apiKey) : null;

  return prisma.llmSetting.upsert({
    where: { accountId },
    update: {
      provider,
      baseUrl,
      model,
      systemLanguage,
      summaryLanguage,
      summaryConcurrency,
      ...(storedApiKey ? { apiKey: storedApiKey } : {})
    },
    create: {
      accountId,
      provider,
      baseUrl,
      model,
      systemLanguage,
      summaryLanguage,
      summaryConcurrency,
      apiKey: storedApiKey
    }
  });
}

export async function upsertLlmSettingsForCurrentAccount(input: LlmSettingsInput) {
  const user = await getCurrentUser();
  return upsertLlmSettingsForAccount(user.accountId, input);
}
