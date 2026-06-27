"use client";

import { useMemo, useState } from "react";

type ProviderKey = "anthropic" | "openai" | "openrouter" | "local";

type ModelOption = {
  value: string;
  label: string;
  note: string;
};

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
  initialProvider
}: {
  hasApiKey: boolean;
  initialBaseUrl: string;
  initialModel: string;
  initialProvider: string;
}) {
  const [provider, setProvider] = useState<ProviderKey>(() => normalizeProvider(initialProvider));
  const [model, setModel] = useState(initialModel);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]);
  const options = useMemo(() => {
    const providerOptions = MODEL_OPTIONS[provider];
    if (!model || providerOptions.some((option) => option.value === model)) return providerOptions;
    return [{ value: model, label: model, note: "Current custom model" }, ...providerOptions];
  }, [model, provider]);

  return (
    <>
      <div className="settingsField">
        <span>Provider</span>
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
        <span>Model</span>
        <select name="model" onChange={(event) => setModel(event.target.value)} value={model}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} - {option.note}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>API key</span>
        <input
          name="apiKey"
          type="password"
          placeholder={hasApiKey ? "Saved key hidden · enter a new key to replace it" : API_KEY_PLACEHOLDERS[provider]}
        />
      </label>
      <details className="settingsAdvanced">
        <summary>Advanced · custom endpoint & embeddings</summary>
        <label>
          <span>Base URL</span>
          <input
            name="baseUrl"
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_BASE_URLS[provider]}
            type="url"
            value={baseUrl}
          />
        </label>
        <label>
          <span>Embedding model</span>
          <input name="embeddingModel" placeholder="voyage-3" />
        </label>
      </details>
    </>
  );
}
