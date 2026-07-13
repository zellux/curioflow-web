"use client";

import { useMemo, useState } from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type ProviderKey = "anthropic" | "openai" | "openrouter" | "local";

type LanguageOption = {
  value: "en" | "zh-Hans";
  label: string;
};

type SummaryLanguageOption = {
  value: "en" | "zh-Hans" | "article";
  label: string;
};

type SummaryRegenerationScope = "all" | "missing";

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

const RECOMMENDED_MODELS: Record<ProviderKey, { ask: string; summary: string }> = {
  anthropic: {
    ask: "claude-fable-5",
    summary: "claude-sonnet-4-6"
  },
  openai: {
    ask: "gpt-5.5",
    summary: "gpt-5.4-mini"
  },
  openrouter: {
    ask: "z-ai/glm-5.2",
    summary: "deepseek/deepseek-v4-flash"
  },
  local: {
    ask: "openai/gpt-oss-120b",
    summary: "llama3.1"
  }
};

const MODEL_SUGGESTIONS: Record<ProviderKey, { ask: Array<{ label: string; value: string }>; summary: Array<{ label: string; value: string }> }> = {
  anthropic: {
    summary: [
      { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
      { label: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
      { label: "Claude Opus 4.8", value: "claude-opus-4-8" }
    ],
    ask: [
      { label: "Claude Fable 5", value: "claude-fable-5" },
      { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
      { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" }
    ]
  },
  openai: {
    summary: [
      { label: "GPT-5.4 mini", value: "gpt-5.4-mini" },
      { label: "GPT-5.4 nano", value: "gpt-5.4-nano" },
      { label: "GPT-4.1 mini", value: "gpt-4.1-mini" }
    ],
    ask: [
      { label: "GPT-5.5", value: "gpt-5.5" },
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 mini", value: "gpt-5.4-mini" }
    ]
  },
  openrouter: {
    summary: [
      { label: "GLM 5.2", value: "z-ai/glm-5.2" },
      { label: "DeepSeek V4 Flash", value: "deepseek/deepseek-v4-flash" },
      { label: "MiMo V2.5", value: "xiaomi/mimo-v2.5" },
      { label: "MiniMax M3", value: "minimax/minimax-m3" },
      { label: "Nemotron 3 Ultra · Free", value: "nvidia/nemotron-3-ultra-550b-a55b:free" }
    ],
    ask: [
      { label: "GLM 5.2", value: "z-ai/glm-5.2" },
      { label: "DeepSeek V4 Flash", value: "deepseek/deepseek-v4-flash" },
      { label: "MiMo V2.5", value: "xiaomi/mimo-v2.5" },
      { label: "MiniMax M3", value: "minimax/minimax-m3" },
      { label: "Nemotron 3 Ultra · Free", value: "nvidia/nemotron-3-ultra-550b-a55b:free" }
    ]
  },
  local: {
    summary: [
      { label: "Llama 3.1", value: "llama3.1" },
      { label: "Qwen 2.5", value: "qwen2.5" },
      { label: "Mistral", value: "mistral" },
      { label: "DeepSeek R1", value: "deepseek-r1" }
    ],
    ask: [
      { label: "GPT OSS 120B", value: "openai/gpt-oss-120b" },
      { label: "Qwen 2.5", value: "qwen2.5" },
      { label: "DeepSeek R1", value: "deepseek-r1" },
      { label: "Llama 3.1", value: "llama3.1" }
    ]
  }
};

function normalizeProvider(provider: string): ProviderKey {
  return provider === "anthropic" || provider === "openrouter" || provider === "local" ? provider : "openai";
}

function normalizeSummaryConcurrency(value: number) {
  return Math.max(MIN_SUMMARY_CONCURRENCY, Math.min(MAX_SUMMARY_CONCURRENCY, Math.floor(value || MIN_SUMMARY_CONCURRENCY)));
}

export function LlmSettingsFields({
  hasApiKey,
  initialAskModel,
  initialBaseUrl,
  initialEnabled,
  initialModel,
  initialProvider,
  locale,
  summaryRegenerationCounts,
  initialSummaryConcurrency,
  initialSummaryLanguage,
  initialSystemLanguage
}: {
  hasApiKey: boolean;
  initialAskModel: string;
  initialBaseUrl: string;
  initialEnabled: boolean;
  initialModel: string;
  initialProvider: string;
  locale: SystemLanguage;
  summaryRegenerationCounts: { all: number; missing: number };
  initialSummaryConcurrency: number;
  initialSummaryLanguage: string;
  initialSystemLanguage: string;
}) {
  const copy = getUiCopy(locale).settings;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [provider, setProvider] = useState<ProviderKey>(() => normalizeProvider(initialProvider));
  const [model, setModel] = useState(initialModel);
  const [askModel, setAskModel] = useState(initialAskModel);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<LlmTestState>({ status: "idle", message: null });
  const [regenerationState, setRegenerationState] = useState<SummaryRegenerationState>({ status: "idle", message: null });
  const [isRegenerationConfirmOpen, setIsRegenerationConfirmOpen] = useState(false);
  const [summaryRegenerationScope, setSummaryRegenerationScope] = useState<SummaryRegenerationScope>("missing");
  const [summaryConcurrency, setSummaryConcurrency] = useState(() => normalizeSummaryConcurrency(initialSummaryConcurrency));
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguageOption["value"]>(
    initialSummaryLanguage === "zh-Hans" || initialSummaryLanguage === "article" ? initialSummaryLanguage : "en"
  );
  const summaryLanguageOptions = useMemo<SummaryLanguageOption[]>(() => [
    { value: "article", label: copy.summaryLanguageOptions.article },
    { value: "en", label: copy.summaryLanguageOptions.en },
    { value: "zh-Hans", label: copy.summaryLanguageOptions["zh-Hans"] }
  ], [copy.summaryLanguageOptions]);
  const recommendedModels = RECOMMENDED_MODELS[provider];
  const modelSuggestions = MODEL_SUGGESTIONS[provider];
  const isTesting = testState.status === "testing";
  const isQueueingRegeneration = regenerationState.status === "queueing";
  const summaryRegenerationCount = summaryRegenerationCounts[summaryRegenerationScope];
  const canRegenerateSummaries = !isQueueingRegeneration && summaryRegenerationCount > 0;
  const decrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value - 1));
  const incrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value + 1));

  async function testConnection() {
    setTestState({ status: "testing", message: copy.testRunning });

    try {
      let lastResponse: string | undefined;
      for (const candidateModel of [...new Set([model, askModel])]) {
        const response = await fetch("/api/settings/llm/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey, baseUrl, model: candidateModel, provider })
        });
        const body = (await response.json().catch(() => null)) as { error?: string; response?: string } | null;

        if (!response.ok) {
          throw new Error(`${candidateModel}: ${body?.error || copy.testFailed}`);
        }
        lastResponse = body?.response;
      }

      setTestState({ status: "success", message: lastResponse ? copy.testSucceededWithResponse(lastResponse) : copy.testSucceeded });
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
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: summaryRegenerationScope })
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
        <h2 className="settingsPaneTitle">{copy.language}</h2>
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
        <div className="settingsField settingsLlmDependent" hidden={!enabled}>
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
        <div className="settingsLlmDependent" hidden={!enabled}>
          <div className="settingsInlineDivider" />
          <div className="settingsSubsection">
            <h3 className="settingsSubsectionTitle">{copy.regenerateSummariesTitle}</h3>
            <p>{copy.regenerateSummariesIntro}</p>
            <div className="summaryRegenerationChoices">
              {(["missing", "all"] as const).map((scope) => (
                <label className="summaryRegenerationChoice" key={scope}>
                  <input
                    checked={summaryRegenerationScope === scope}
                    name="summaryRegenerationScope"
                    onChange={() => {
                      setSummaryRegenerationScope(scope);
                      setRegenerationState({ status: "idle", message: null });
                    }}
                    type="radio"
                    value={scope}
                  />
                  <span>
                    <strong>{copy.regenerateSummariesScope[scope]}</strong>
                    <small>{copy.regenerateSummariesScopeHelp[scope](summaryRegenerationCounts[scope])}</small>
                  </span>
                </label>
              ))}
            </div>
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
        </div>
        {isRegenerationConfirmOpen ? (
          <div className="settingsConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="regenerate-summaries-title">
            <button className="settingsConfirmBackdrop" aria-label={copy.cancel} onClick={() => setIsRegenerationConfirmOpen(false)} type="button" />
            <section className="settingsConfirmPanel">
              <h2 id="regenerate-summaries-title">{copy.regenerateSummariesConfirmTitle(summaryRegenerationScope)}</h2>
              <p>{copy.regenerateSummariesConfirm(summaryRegenerationCount, summaryRegenerationScope)}</p>
              <div>
                <button onClick={() => setIsRegenerationConfirmOpen(false)} type="button">{copy.cancel}</button>
                <button onClick={regenerateSummaries} type="button">{copy.regenerateSummariesConfirmAction}</button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
      <section className="settingsSection settingsPanelPane settingsPanelPane--model">
        <h2 className="settingsPaneTitle">{copy.languageModel}</h2>
        <p className="settingsIntro">{copy.languageModelIntro}</p>
        <label className="settingsLlmToggle">
          <span>
            <strong>{copy.llmEnabled}</strong>
            <small>{copy.llmEnabledHelp}</small>
          </span>
          <input
            checked={enabled}
            name="enabled"
            onChange={(event) => {
              setEnabled(event.target.checked);
              if (!event.target.checked) setIsRegenerationConfirmOpen(false);
            }}
            type="checkbox"
            value="true"
          />
          <i aria-hidden="true" />
        </label>
        <p className={`settingsLlmMode ${enabled ? "isEnabled" : "isDisabled"}`}>
          {enabled ? copy.llmModeEnabled : copy.llmModeDisabled}
        </p>
        <div className="settingsLlmConfiguration" hidden={!enabled}>
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
                      setModel(RECOMMENDED_MODELS[providerOption.value].summary);
                      setAskModel(RECOMMENDED_MODELS[providerOption.value].ask);
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
        <div className="settingsModelField">
          <label htmlFor="summary-model">{copy.summaryModel}</label>
          <input
            autoComplete="off"
            id="summary-model"
            name="model"
            onChange={(event) => setModel(event.target.value)}
            placeholder={recommendedModels.summary}
            required
            spellCheck={false}
            value={model}
          />
          <div aria-label={copy.availableModels} className="settingsModelSuggestions" role="group">
            {modelSuggestions.summary.map((suggestion) => (
              <button
                aria-pressed={model === suggestion.value}
                key={suggestion.value}
                onClick={() => setModel(suggestion.value)}
                type="button"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settingsModelField">
          <label htmlFor="ask-model">{copy.askModel}</label>
          <input
            autoComplete="off"
            id="ask-model"
            name="askModel"
            onChange={(event) => setAskModel(event.target.value)}
            placeholder={recommendedModels.ask}
            required
            spellCheck={false}
            value={askModel}
          />
          <div aria-label={copy.availableModels} className="settingsModelSuggestions" role="group">
            {modelSuggestions.ask.map((suggestion) => (
              <button
                aria-pressed={askModel === suggestion.value}
                key={suggestion.value}
                onClick={() => setAskModel(suggestion.value)}
                type="button"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
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
