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

type SummaryLanguageOption = {
  value: "en" | "zh-Hans" | "article";
  label: string;
};

type LlmTestState =
  | { status: "idle"; message: string | null }
  | { status: "testing"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type SummaryRegenerationState =
  | { status: "idle"; message: string | null }
  | { status: "queueing"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

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

const MAX_SUMMARY_CONCURRENCY = 10;
const MIN_SUMMARY_CONCURRENCY = 1;

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

function normalizeSummaryConcurrency(value: number) {
  return Math.max(MIN_SUMMARY_CONCURRENCY, Math.min(MAX_SUMMARY_CONCURRENCY, Math.floor(value || MIN_SUMMARY_CONCURRENCY)));
}

export function LlmSettingsFields({
  hasApiKey,
  initialBaseUrl,
  initialModel,
  initialProvider,
  locale,
  summaryRegenerationCount,
  initialSummaryConcurrency,
  initialSummaryLanguage,
  initialSystemLanguage
}: {
  hasApiKey: boolean;
  initialBaseUrl: string;
  initialModel: string;
  initialProvider: string;
  locale: SystemLanguage;
  summaryRegenerationCount: number;
  initialSummaryConcurrency: number;
  initialSummaryLanguage: string;
  initialSystemLanguage: string;
}) {
  const copy = getUiCopy(locale).settings;
  const [provider, setProvider] = useState<ProviderKey>(() => normalizeProvider(initialProvider));
  const [model, setModel] = useState(initialModel);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<LlmTestState>({ status: "idle", message: null });
  const [regenerationState, setRegenerationState] = useState<SummaryRegenerationState>({ status: "idle", message: null });
  const [isRegenerationConfirmOpen, setIsRegenerationConfirmOpen] = useState(false);
  const [summaryConcurrency, setSummaryConcurrency] = useState(() => normalizeSummaryConcurrency(initialSummaryConcurrency));
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguageOption["value"]>(
    initialSummaryLanguage === "zh-Hans" || initialSummaryLanguage === "article" ? initialSummaryLanguage : "en"
  );
  const summaryLanguageOptions = useMemo<SummaryLanguageOption[]>(() => [
    { value: "article", label: copy.summaryLanguageOptions.article },
    { value: "en", label: copy.summaryLanguageOptions.en },
    { value: "zh-Hans", label: copy.summaryLanguageOptions["zh-Hans"] }
  ], [copy.summaryLanguageOptions]);
  const options = useMemo(() => {
    const providerOptions = MODEL_OPTIONS[provider];
    if (!model || providerOptions.some((option) => option.value === model)) return providerOptions;
    return [{ value: model, label: model, note: "Current custom model" }, ...providerOptions];
  }, [model, provider]);
  const isTesting = testState.status === "testing";
  const isQueueingRegeneration = regenerationState.status === "queueing";
  const canRegenerateSummaries = !isQueueingRegeneration && summaryRegenerationCount > 0;
  const decrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value - 1));
  const incrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value + 1));

  async function testConnection() {
    setTestState({ status: "testing", message: copy.testRunning });

    try {
      const response = await fetch("/api/settings/llm/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, baseUrl, model, provider })
      });
      const body = (await response.json().catch(() => null)) as { error?: string; response?: string } | null;

      if (!response.ok) {
        throw new Error(body?.error || copy.testFailed);
      }

      setTestState({ status: "success", message: body?.response ? copy.testSucceededWithResponse(body.response) : copy.testSucceeded });
    } catch (error) {
      setTestState({ status: "error", message: error instanceof Error ? error.message : copy.testFailed });
    }
  }

  function requestSummaryRegeneration() {
    if (summaryRegenerationCount <= 0) {
      setRegenerationState({ status: "error", message: copy.regenerateSummariesEmpty });
      return;
    }

    setIsRegenerationConfirmOpen(true);
  }

  async function regenerateSummaries() {
    setIsRegenerationConfirmOpen(false);
    setRegenerationState({ status: "queueing", message: copy.regenerateSummariesQueueing });

    try {
      const response = await fetch("/api/settings/llm/regenerate-summaries", {
        method: "POST"
      });
      const body = (await response.json().catch(() => null)) as { queued?: number; error?: string } | null;

      if (!response.ok) {
        throw new Error(body?.error || copy.regenerateSummariesFailed);
      }

      setRegenerationState({
        status: "success",
        message: copy.regenerateSummariesQueued(body?.queued ?? 0)
      });
    } catch (error) {
      setRegenerationState({
        status: "error",
        message: error instanceof Error ? error.message : copy.regenerateSummariesFailed
      });
    }
  }

  return (
    <>
      <section className="settingsSection settingsPanelPane settingsPanelPane--language">
        <h3 className="settingsPaneTitle">{copy.language}</h3>
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
          <div className="languageChoices languageChoices--three">
            {summaryLanguageOptions.map((language) => (
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
        <div className="settingsInlineDivider" />
        <div className="settingsSubsection">
          <h3 className="settingsSubsectionTitle">{copy.regenerateSummariesTitle}</h3>
          <p>{copy.regenerateSummariesIntro}</p>
          <div className={`settingsActionRow ${regenerationState.status === "success" ? "settingsActionRow--success" : regenerationState.status === "error" ? "settingsActionRow--error" : ""}`}>
            <button className="settingsAccentAction" disabled={!canRegenerateSummaries} onClick={requestSummaryRegeneration} type="button">
              {isQueueingRegeneration ? <span className="settingsButtonSpinner" aria-hidden="true" /> : <RegenerateIcon />}
              <span>{isQueueingRegeneration ? copy.regenerateSummariesQueueing : copy.regenerateSummaries}</span>
            </button>
            <p>
              {regenerationState.message ?? copy.regenerateSummariesHelp(summaryRegenerationCount)}
            </p>
          </div>
        </div>
        {isRegenerationConfirmOpen ? (
          <div className="settingsConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="regenerate-summaries-title">
            <button className="settingsConfirmBackdrop" aria-label={copy.cancel} onClick={() => setIsRegenerationConfirmOpen(false)} type="button" />
            <section className="settingsConfirmPanel">
              <h2 id="regenerate-summaries-title">{copy.regenerateSummariesConfirmTitle}</h2>
              <p>{copy.regenerateSummariesConfirm(summaryRegenerationCount)}</p>
              <div>
                <button onClick={() => setIsRegenerationConfirmOpen(false)} type="button">{copy.cancel}</button>
                <button onClick={regenerateSummaries} type="button">{copy.regenerateSummariesConfirmAction}</button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
      <section className="settingsSection settingsPanelPane settingsPanelPane--model">
        <h3 className="settingsPaneTitle">{copy.languageModel}</h3>
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
          {provider === "local" ? (
            <input
              name="model"
              onChange={(event) => setModel(event.target.value)}
              placeholder="llama3.1"
              value={model}
            />
          ) : (
            <select name="model" onChange={(event) => setModel(event.target.value)} value={model}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.note}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span>{copy.apiKey}</span>
          <input
            name="apiKey"
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder={hasApiKey ? "Saved key hidden · enter a new key to replace it" : API_KEY_PLACEHOLDERS[provider]}
            value={apiKey}
          />
        </label>
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
        <input name="summaryConcurrency" type="hidden" value={summaryConcurrency} />
        <div className="settingsInlineDivider" />
        <div className="settingsParallelControl">
          <span>{copy.maxParallelRequests}</span>
          <p>{copy.maxParallelRequestsHint}</p>
          <div>
            <button
              aria-label={copy.decreaseMaxParallelRequests}
              disabled={summaryConcurrency <= MIN_SUMMARY_CONCURRENCY}
              onClick={decrementSummaryConcurrency}
              type="button"
            >
              -
            </button>
            <output aria-live="polite">{summaryConcurrency}</output>
            <button
              aria-label={copy.increaseMaxParallelRequests}
              disabled={summaryConcurrency >= MAX_SUMMARY_CONCURRENCY}
              onClick={incrementSummaryConcurrency}
              type="button"
            >
              +
            </button>
            <small>{copy.maxParallelRequestsRange}</small>
          </div>
        </div>
        <div className={`settingsTest ${testState.status !== "idle" ? `settingsTest--${testState.status}` : ""}`}>
          <button disabled={isTesting} onClick={testConnection} type="button">
            {isTesting ? copy.testRunning : copy.testConnection}
          </button>
          {testState.message ? <p>{testState.message}</p> : null}
        </div>
      </section>
    </>
  );
}

function RegenerateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
