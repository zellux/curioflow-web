"use client";

import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getUiCopy,
  normalizeSummaryLanguage,
  normalizeSystemLanguage,
  pickLocale,
  SYSTEM_LANGUAGE_LABELS,
  SYSTEM_LANGUAGES,
  type SummaryLanguage,
  type SystemLanguage
} from "@/app/i18n";
import { modelContextWindowPreset } from "@/llm-context";

type ProviderKey = "anthropic" | "meta" | "openai" | "openrouter" | "local";

type LanguageOption = {
  value: SystemLanguage;
  label: string;
};

type SummaryLanguageOption = {
  value: SummaryLanguage;
  label: string;
};

type LlmTestState =
  | { status: "idle"; message: string | null }
  | { status: "testing"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const LANGUAGE_OPTIONS: LanguageOption[] = SYSTEM_LANGUAGES.map((value) => ({
  value,
  label: SYSTEM_LANGUAGE_LABELS[value]
}));

const PROVIDERS: Array<{ value: ProviderKey; label: string }> = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "meta", label: "Meta API" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "local", label: "Local / Ollama" }
];

const MAX_SUMMARY_CONCURRENCY = 10;
const MIN_SUMMARY_CONCURRENCY = 1;

const DEFAULT_BASE_URLS: Record<ProviderKey, string> = {
  anthropic: "https://api.anthropic.com/v1",
  meta: "https://api.meta.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  local: "http://localhost:11434/v1"
};

const API_KEY_PLACEHOLDERS: Record<ProviderKey, string> = {
  anthropic: "sk-ant-...",
  meta: "LLM|...|...",
  openai: "sk-...",
  openrouter: "sk-or-...",
  local: "Optional for local endpoints"
};

const RECOMMENDED_MODELS: Record<ProviderKey, { ask: string; summary: string }> = {
  meta: {
    ask: "muse-spark-1.3",
    summary: "muse-spark-1.3"
  },
  anthropic: {
    ask: "claude-opus-5-5",
    summary: "claude-sonnet-5-5"
  },
  openai: {
    ask: "gpt-6.1-sol",
    summary: "gpt-6-luna"
  },
  openrouter: {
    ask: "z-ai/glm-5.3",
    summary: "deepseek/deepseek-v4.1-flash"
  },
  local: {
    ask: "openai/gpt-oss-120b",
    summary: "llama3.1"
  }
};

const MODEL_SUGGESTIONS: Record<ProviderKey, { ask: Array<{ label: string; value: string }>; summary: Array<{ label: string; value: string }> }> = {
  meta: {
    summary: [
      { label: "Muse Spark 1.3", value: "muse-spark-1.3" },
      { label: "Muse Spark 1.3 Contributor", value: "muse-spark-1.3-contributor" }
    ],
    ask: [
      { label: "Muse Spark 1.3", value: "muse-spark-1.3" },
      { label: "Muse Spark 1.3 Contributor", value: "muse-spark-1.3-contributor" },
      { label: "Muse Wonder 1.0", value: "muse-wonder-1.0" }
    ]
  },
  anthropic: {
    summary: [
      { label: "Claude Sonnet 5.5", value: "claude-sonnet-5-5" },
      { label: "Claude Haiku 5.5", value: "claude-haiku-5-5" },
      { label: "Claude Opus 5.5", value: "claude-opus-5-5" }
    ],
    ask: [
      { label: "Claude Opus 5.5", value: "claude-opus-5-5" },
      { label: "Claude Sonnet 5.5", value: "claude-sonnet-5-5" },
      { label: "Claude Fable 5.1", value: "claude-fable-5-1" },
      { label: "Claude Haiku 5.5", value: "claude-haiku-5-5" }
    ]
  },
  openai: {
    summary: [
      { label: "GPT-6 Luna", value: "gpt-6-luna" },
      { label: "GPT-6.1 Sol", value: "gpt-6.1-sol" },
      { label: "GPT-6 Astra", value: "gpt-6-astra" }
    ],
    ask: [
      { label: "GPT-6.1 Sol", value: "gpt-6.1-sol" },
      { label: "GPT-6 Astra", value: "gpt-6-astra" },
      { label: "GPT-6 Luna", value: "gpt-6-luna" }
    ]
  },
  openrouter: {
    summary: [
      { label: "DeepSeek V4.1 Flash", value: "deepseek/deepseek-v4.1-flash" },
      { label: "GLM 5.3 Flash", value: "z-ai/glm-5.3-flash" },
      { label: "MiMo V2.6 Flash", value: "xiaomi/mimo-v2.6-flash" },
      { label: "MiniMax M3", value: "minimax/minimax-m3" },
      { label: "Nemotron 3 Ultra · Free", value: "nvidia/nemotron-3-ultra-550b-a55b:free" }
    ],
    ask: [
      { label: "GLM 5.3", value: "z-ai/glm-5.3" },
      { label: "DeepSeek V4.1 Flash", value: "deepseek/deepseek-v4.1-flash" },
      { label: "MiMo V2.6 Flash", value: "xiaomi/mimo-v2.6-flash" },
      { label: "MiniMax M3", value: "minimax/minimax-m3" },
      { label: "Nemotron 3 Ultra · Free", value: "nvidia/nemotron-3-ultra-550b-a55b:free" }
    ]
  },
  local: {
    summary: [
      { label: "Qwen3 30B A3B", value: "qwen/qwen3-30b-a3b-2507" },
      { label: "Llama 3.1", value: "llama3.1" },
      { label: "Qwen 2.5", value: "qwen2.5" },
      { label: "Mistral", value: "mistral" },
      { label: "DeepSeek R1", value: "deepseek-r1" }
    ],
    ask: [
      { label: "GPT OSS 120B", value: "openai/gpt-oss-120b" },
      { label: "Qwen3 30B A3B", value: "qwen/qwen3-30b-a3b-2507" },
      { label: "Qwen 2.5", value: "qwen2.5" },
      { label: "DeepSeek R1", value: "deepseek-r1" },
      { label: "Llama 3.1", value: "llama3.1" }
    ]
  }
};

function normalizeProvider(provider: string): ProviderKey {
  return provider === "anthropic" || provider === "meta" || provider === "openrouter" || provider === "local" ? provider : "openai";
}

function normalizeSummaryConcurrency(value: number) {
  return Math.max(MIN_SUMMARY_CONCURRENCY, Math.min(MAX_SUMMARY_CONCURRENCY, Math.floor(value || MIN_SUMMARY_CONCURRENCY)));
}

const CONTEXT_WINDOW_COPY: Record<SystemLanguage, {
  automatic: string;
  hint: string;
  label: string;
  useModelCapacity: string;
}> = {
  en: {
    automatic: "Automatic",
    hint: "Leave empty to use the model capacity, a known model preset, or 16,384 tokens if unknown. For local models, use the loaded context size.",
    label: "Context usage limit (tokens)",
    useModelCapacity: "Use model capacity"
  },
  "zh-Hans": {
    automatic: "自动",
    hint: "留空自动使用模型容量；未探测到时使用常见模型预设，否则使用 16,384 tokens。本地模型请按实际加载窗口填写。",
    label: "上下文使用上限（tokens）",
    useModelCapacity: "使用模型容量"
  },
  "zh-Hant": {
    automatic: "自動",
    hint: "留空將自動使用模型容量；未偵測到時使用常見模型預設，否則使用 16,384 tokens。本機模型請依實際載入的視窗大小填寫。",
    label: "上下文使用上限（tokens）",
    useModelCapacity: "使用模型容量"
  },
  ja: {
    automatic: "自動",
    hint: "空欄にするとモデル容量、既知のプリセット、または 16,384 トークンを自動使用します。ローカルモデルでは実際に読み込んだコンテキスト長を指定してください。",
    label: "コンテキスト使用上限（トークン）",
    useModelCapacity: "モデル容量を使用"
  },
  ko: {
    automatic: "자동",
    hint: "비워 두면 모델 용량, 알려진 프리셋 또는 16,384 토큰을 자동으로 사용합니다. 로컬 모델은 실제 로드된 컨텍스트 크기를 입력하세요.",
    label: "컨텍스트 사용 한도(토큰)",
    useModelCapacity: "모델 용량 사용"
  }
};

function ContextWindowField({ name, value, onChange, capacity, locale }: {
  name: string; value: string; onChange: (value: string) => void; capacity: number | null; locale: SystemLanguage;
}) {
  const ctxCopy = pickLocale(locale, CONTEXT_WINDOW_COPY);
  const format = (tokens: number) => new Intl.NumberFormat(locale).format(tokens);
  return <div className="settingsContextLimit">
    <label htmlFor={name}>{ctxCopy.label}</label>
    <input id={name} name={name} type="number" min={2048} max={capacity ?? 10_000_000} step={1}
      placeholder={ctxCopy.automatic} value={value} onChange={event => onChange(event.target.value)} list={`${name}-presets`} />
    <datalist id={`${name}-presets`}>
      {[...new Set([8192, 32768, 65536, 128000, 262144, ...(capacity ? [capacity] : [])])].filter(tokens => !capacity || tokens <= capacity).map(tokens => <option key={tokens} value={tokens}>{format(tokens)}</option>)}
    </datalist>
    <div className="settingsModelSuggestions">
      <button type="button" aria-pressed={!value} onClick={() => onChange("")}>{ctxCopy.automatic}</button>
      {capacity ? <button type="button" aria-pressed={value === String(capacity)} onClick={() => onChange(String(capacity))}>
        {ctxCopy.useModelCapacity} · {format(capacity)}
      </button> : null}
    </div>
    <p className="settingsModelContextWindow">{ctxCopy.hint}</p>
  </div>;
}

export function LlmSettingsFields({
  hasApiKey,
  initialAskModel,
  initialAskModelContextWindow,
  initialContextWindowLimit,
  initialAskContextWindowLimit,
  initialBaseUrl,
  initialEnabled,
  initialModel,
  initialModelContextWindow,
  initialProvider,
  contextWindowError,
  locale,
  settingsSaved,
  initialSummaryConcurrency,
  initialSummaryLanguage,
  initialSystemLanguage,
  onDirtyChange
}: {
  hasApiKey: boolean;
  initialAskModel: string;
  initialAskModelContextWindow: number | null;
  initialContextWindowLimit: number | null;
  initialAskContextWindowLimit: number | null;
  initialBaseUrl: string;
  initialEnabled: boolean;
  initialModel: string;
  initialModelContextWindow: number | null;
  initialProvider: string;
  contextWindowError?: string;
  locale: SystemLanguage;
  settingsSaved: boolean;
  initialSummaryConcurrency: number;
  initialSummaryLanguage: string;
  initialSystemLanguage: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const copy = getUiCopy(locale).settings;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [provider, setProvider] = useState<ProviderKey>(() => normalizeProvider(initialProvider));
  const [model, setModel] = useState(initialModel);
  const [askModel, setAskModel] = useState(initialAskModel);
  const [contextWindowLimit, setContextWindowLimit] = useState(initialContextWindowLimit?.toString() ?? "");
  const [askContextWindowLimit, setAskContextWindowLimit] = useState(initialAskContextWindowLimit?.toString() ?? "");
  const selectModel = (value: string) => { if (value !== model) setContextWindowLimit(""); setModel(value); };
  const selectAskModel = (value: string) => { if (value !== askModel) setAskContextWindowLimit(""); setAskModel(value); };
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]);
  const [apiKey, setApiKey] = useState("");
  const [systemLanguage, setSystemLanguage] = useState<SystemLanguage>(() => normalizeSystemLanguage(initialSystemLanguage));
  const configuration = JSON.stringify([enabled, provider, baseUrl, model, SHOW_DRAFT_READING_TOOLS ? askModel : null, apiKey]);
  const testController = useRef<AbortController | null>(null);
  const [testResult, setTestResult] = useState<LlmTestState & { configuration: string }>({ status: "idle", message: null, configuration });
  const changedMessage = pickLocale(locale, {
    en: "Configuration changed. Test again.",
    "zh-Hans": "配置已修改，请重新测试。",
    "zh-Hant": "設定已修改，請重新測試。",
    ja: "設定が変更されました。もう一度テストしてください。",
    ko: "설정이 변경되었습니다. 다시 테스트해 주세요."
  });
  const testState: LlmTestState = testResult.configuration === configuration ? testResult : { status: "idle", message: changedMessage };
  useEffect(() => {
    setTestResult(previous => previous.configuration === configuration ? previous : { status: "idle", message: changedMessage, configuration });
    return () => testController.current?.abort();
  }, [configuration, changedMessage]);
  const [summaryConcurrency, setSummaryConcurrency] = useState(() => normalizeSummaryConcurrency(initialSummaryConcurrency));
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguageOption["value"]>(
    () => normalizeSummaryLanguage(initialSummaryLanguage)
  );
  const summaryLanguageOptions = useMemo<SummaryLanguageOption[]>(() => [
    { value: "article", label: copy.summaryLanguageOptions.article },
    ...SYSTEM_LANGUAGES.map((value) => ({ value, label: copy.summaryLanguageOptions[value] }))
  ], [copy.summaryLanguageOptions]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dirty = enabled !== initialEnabled || provider !== normalizeProvider(initialProvider)
    || model !== initialModel
    || contextWindowLimit !== (initialContextWindowLimit?.toString() ?? "")
    || (SHOW_DRAFT_READING_TOOLS && (
      askModel !== initialAskModel || askContextWindowLimit !== (initialAskContextWindowLimit?.toString() ?? "")
    ))
    || baseUrl !== (initialBaseUrl || DEFAULT_BASE_URLS[normalizeProvider(initialProvider)]) || apiKey !== ""
    || summaryConcurrency !== normalizeSummaryConcurrency(initialSummaryConcurrency)
    || summaryLanguage !== normalizeSummaryLanguage(initialSummaryLanguage)
    || systemLanguage !== normalizeSystemLanguage(initialSystemLanguage);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const recommendedModels = RECOMMENDED_MODELS[provider];
  const modelSuggestions = MODEL_SUGGESTIONS[provider];
  const isTesting = testState.status === "testing";
  const connectionMatchesDetectedContext = provider === normalizeProvider(initialProvider)
    && baseUrl === initialBaseUrl
    && apiKey === "";
  const displayedModelContextWindow = connectionMatchesDetectedContext && model === initialModel
    ? initialModelContextWindow
    : null;
  const displayedAskModelContextWindow = connectionMatchesDetectedContext && askModel === initialAskModel
    ? initialAskModelContextWindow
    : null;
  const decrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value - 1));
  const incrementSummaryConcurrency = () => setSummaryConcurrency((value) => normalizeSummaryConcurrency(value + 1));

  async function testConnection() {
    testController.current?.abort();
    const controller = new AbortController();
    testController.current = controller;
    setTestResult({ status: "testing", message: copy.testRunning, configuration });

    try {
      let lastResponse: string | undefined;
      const models = SHOW_DRAFT_READING_TOOLS ? new Set([model, askModel]) : [model];
      for (const candidateModel of models) {
        const response = await fetch("/api/settings/llm/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey, baseUrl, model: candidateModel, provider }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
        });
        const body = (await response.json().catch(() => null)) as { error?: string; response?: string } | null;

        if (!response.ok) {
          throw new Error(`${candidateModel}: ${body?.error || copy.testFailed}`);
        }
        lastResponse = body?.response;
      }

      if (!controller.signal.aborted) setTestResult({ status: "success", message: lastResponse ? copy.testSucceededWithResponse(lastResponse) : copy.testSucceeded, configuration });
    } catch (error) {
      if (!controller.signal.aborted) setTestResult({ status: "error", message: error instanceof Error ? error.message : copy.testFailed, configuration });
    }
  }

  return (
    <>
      <section className="settingsSection settingsPanelPane settingsPanelPane--language">
        <h2 className="settingsPaneTitle">{copy.language}</h2>
        <p className="settingsIntro">{copy.languageIntro}</p>
        <div className="settingsField">
          <label htmlFor="settings-system-language">{copy.interfaceLanguage}</label>
          <div className="settingsSelectWrap">
            <select
              id="settings-system-language"
              name="systemLanguage"
              onChange={(event) => setSystemLanguage(normalizeSystemLanguage(event.target.value))}
              value={systemLanguage}
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <SelectChevronIcon />
          </div>
        </div>
        <div className="settingsField settingsLlmDependent" hidden={!enabled}>
          <label htmlFor="settings-summary-language">{copy.summaryLanguage}</label>
          <div className="settingsSelectWrap">
            <select
              id="settings-summary-language"
              name="summaryLanguage"
              onChange={(event) => setSummaryLanguage(normalizeSummaryLanguage(event.target.value))}
              value={summaryLanguage}
            >
              {summaryLanguageOptions.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <SelectChevronIcon />
          </div>
          <p className="settingsModelContextWindow">{copy.summaryLanguageHint[summaryLanguage]}</p>
        </div>
      </section>
      <section className="settingsSection settingsPanelPane settingsPanelPane--model">
        <h2 className="settingsPaneTitle">{copy.languageModel}</h2>
        <p className="settingsIntro">{copy.languageModelIntro}</p>
        {settingsSaved && !dirty && !contextWindowError ? (
          <p className="settingsSaved" role="status">{copy.llmSaved}</p>
        ) : null}
        {contextWindowError ? (
          <p className="settingsContextWindowError" role="alert">
            <strong>{copy.llmSavedContextError}</strong>
            <span>{contextWindowError}</span>
          </p>
        ) : null}
        <label className="settingsLlmToggle">
          <span>
            <strong>{copy.llmEnabled}</strong>
            <small>{copy.llmEnabledHelp}</small>
          </span>
          <input
            checked={enabled}
            name="enabled"
            onChange={(event) => setEnabled(event.target.checked)}
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
                      setContextWindowLimit("");
                      setAskContextWindowLimit("");
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
            onChange={(event) => selectModel(event.target.value)}
            placeholder={recommendedModels.summary}
            required
            spellCheck={false}
            value={model}
          />
          <p className="settingsModelContextWindow">
            {displayedModelContextWindow
              ? copy.contextWindowDetected(numberFormatter.format(displayedModelContextWindow))
              : modelContextWindowPreset(provider, model)
                ? copy.contextWindowPreset(numberFormatter.format(modelContextWindowPreset(provider, model)!))
                : copy.contextWindowUnknown}
          </p>
          <ContextWindowField name="contextWindowLimit" value={contextWindowLimit} onChange={setContextWindowLimit}
            capacity={displayedModelContextWindow ?? modelContextWindowPreset(provider, model)} locale={locale} />
          <div aria-label={copy.availableModels} className="settingsModelSuggestions" role="group">
            {modelSuggestions.summary.map((suggestion) => (
              <button
                aria-pressed={model === suggestion.value}
                key={suggestion.value}
                onClick={() => selectModel(suggestion.value)}
                type="button"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
        {SHOW_DRAFT_READING_TOOLS ? (
          <div className="settingsModelField">
            <label htmlFor="ask-model">{copy.askModel}</label>
            <input
              autoComplete="off"
              id="ask-model"
              name="askModel"
              onChange={(event) => selectAskModel(event.target.value)}
              placeholder={recommendedModels.ask}
              required
              spellCheck={false}
              value={askModel}
            />
            <p className="settingsModelContextWindow">
              {displayedAskModelContextWindow
                ? copy.contextWindowDetected(numberFormatter.format(displayedAskModelContextWindow))
                : modelContextWindowPreset(provider, askModel)
                  ? copy.contextWindowPreset(numberFormatter.format(modelContextWindowPreset(provider, askModel)!))
                  : copy.contextWindowUnknown}
            </p>
            <ContextWindowField name="askContextWindowLimit" value={askContextWindowLimit} onChange={setAskContextWindowLimit}
              capacity={displayedAskModelContextWindow ?? modelContextWindowPreset(provider, askModel)} locale={locale} />
            <div aria-label={copy.availableModels} className="settingsModelSuggestions" role="group">
              {modelSuggestions.ask.map((suggestion) => (
                <button
                  aria-pressed={askModel === suggestion.value}
                  key={suggestion.value}
                  onClick={() => selectAskModel(suggestion.value)}
                  type="button"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
          <span>{copy.apiKey}</span>
          <input
            name="apiKey"
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder={hasApiKey ? "Saved key hidden · enter a new key to replace it" : API_KEY_PLACEHOLDERS[provider]}
            value={apiKey}
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
            {testState.message ? <p role="status">{testState.message}</p> : null}
          </div>
        </div>
      </section>
    </>
  );
}

function SelectChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
