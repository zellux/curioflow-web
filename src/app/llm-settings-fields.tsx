"use client";

import { useMemo, useState } from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type ProviderKey = "anthropic" | "openai" | "openrouter" | "local";

type ModelOption = {
  value: string;
  label: string;
  note: string;
};

type LanguageOption = {
  value: "en" | "zh-Hans";
  label: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" }
];

const PROVIDERS: Array<{ value: ProviderKey; label: string }> = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "local", label: "Local / Ollama" }
];

const DEFAULT_BASE_URLS: Record<ProviderKey, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  local: "http://localhost:11434/v1"
};

const API_KEY_PLACEHOLDERS: Record<ProviderKey, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  openrouter: "sk-or-...",
  local: "Optional for local endpoints"
};

const MODEL_OPTIONS: Record<ProviderKey, ModelOption[]> = {
  anthropic: [
    { value: "claude-fable-5", label: "Claude Fable 5", note: "Most capable" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", note: "Complex reasoning" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Balanced" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fast" }
  ],
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5", note: "Flagship" },
    { value: "gpt-5.4", label: "GPT-5.4", note: "Reasoning" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", note: "Fast / lower cost" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 nano", note: "Lowest latency" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "Legacy default" }
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", note: "Anthropic via OpenRouter" },
    { value: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", note: "OpenAI via OpenRouter" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Google via OpenRouter" },
    { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", note: "Open model" }
  ],
  local: [
    { value: "llama3.1", label: "Llama 3.1", note: "Ollama" },
    { value: "qwen2.5", label: "Qwen 2.5", note: "Ollama" },
    { value: "mistral", label: "Mistral", note: "Ollama" },
    { value: "deepseek-r1", label: "DeepSeek R1", note: "Ollama" }
  ]
};

function normalizeProvider(provider: string): ProviderKey {
  return provider === "anthropic" || provider === "openrouter" || provider === "local" ? provider : "openai";
}

export function LlmSettingsFields({
  hasApiKey,
  initialBaseUrl,
  initialModel,
  initialProvider,
  locale,
  initialSummaryLanguage,
  initialSystemLanguage
}: {
  hasApiKey: boolean;
  initialBaseUrl: string;
  initialModel: string;
  initialProvider: string;
  locale: SystemLanguage;
  initialSummaryLanguage: string;
  initialSystemLanguage: string;
}) {
  const copy = getUiCopy(locale).settings;
  const [provider, setProvider] = useState<ProviderKey>(() => normalizeProvider(initialProvider));
  const [model, setModel] = useState(initialModel);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]);
  const [summaryLanguage, setSummaryLanguage] = useState<LanguageOption["value"]>(
    initialSummaryLanguage === "zh-Hans" ? "zh-Hans" : "en"
  );
  const options = useMemo(() => {
    const providerOptions = MODEL_OPTIONS[provider];
    if (!model || providerOptions.some((option) => option.value === model)) return providerOptions;
    return [{ value: model, label: model, note: "Current custom model" }, ...providerOptions];
  }, [model, provider]);

  return (
    <>
      <section className="settingsSection settingsSectionDivided">
        <div className="settingsKicker">{copy.language}</div>
        <p className="settingsIntro">{copy.languageIntro}</p>
        <div className="settingsField">
          <span>{copy.interfaceLanguage}</span>
          <div className="languageChoices">
            {LANGUAGE_OPTIONS.map((language) => (
              <label className="languageChoice" key={language.value}>
                <input
                  defaultChecked={(initialSystemLanguage === "zh-Hans" ? "zh-Hans" : "en") === language.value}
                  name="systemLanguage"
                  type="radio"
                  value={language.value}
                />
                <span>{language.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="settingsField">
          <span>{copy.summaryLanguage}</span>
          <div className="languageChoices">
            {LANGUAGE_OPTIONS.map((language) => (
              <label className="languageChoice" key={language.value}>
                <input
                  checked={summaryLanguage === language.value}
                  name="summaryLanguage"
                  onChange={() => setSummaryLanguage(language.value)}
                  type="radio"
                  value={language.value}
                />
                <span>{language.label}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="settingsLanguageHint">{copy.summaryLanguageHint[summaryLanguage]}</p>
      </section>
      <section className="settingsSection settingsSectionDivided">
        <div className="settingsKicker">{copy.languageModel}</div>
        <p className="settingsIntro">{copy.languageModelIntro}</p>
        <div className="settingsField">
          <span>{copy.provider}</span>
          <div className="providerChoices">
            {PROVIDERS.map((providerOption) => (
              <label className="providerChoice" key={providerOption.value}>
                <input
                  checked={provider === providerOption.value}
                  name="provider"
                  onChange={() => {
                    setProvider(providerOption.value);
                    setModel(MODEL_OPTIONS[providerOption.value][0]?.value ?? "");
                    setBaseUrl(DEFAULT_BASE_URLS[providerOption.value]);
                  }}
                  type="radio"
                  value={providerOption.value}
                />
                <span>{providerOption.label}</span>
              </label>
            ))}
          </div>
        </div>
        <label>
          <span>{copy.model}</span>
          <select name="model" onChange={(event) => setModel(event.target.value)} value={model}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} - {option.note}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.apiKey}</span>
          <input
            name="apiKey"
            type="password"
            placeholder={hasApiKey ? "Saved key hidden · enter a new key to replace it" : API_KEY_PLACEHOLDERS[provider]}
          />
        </label>
        <details className="settingsAdvanced">
          <summary>{copy.advanced}</summary>
          <label>
            <span>{copy.baseUrl}</span>
            <input
              name="baseUrl"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URLS[provider]}
              type="url"
              value={baseUrl}
            />
          </label>
          <label>
            <span>{copy.embeddingModel}</span>
            <input name="embeddingModel" placeholder="voyage-3" />
          </label>
        </details>
      </section>
    </>
  );
}
