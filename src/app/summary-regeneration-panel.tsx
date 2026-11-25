"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
import { useModalFocus } from "@/app/use-modal-focus";

type SummaryRegenerationScope = "all" | "missing";

type SummaryRegenerationCounts = {
  all: number;
  missing: number;
};

type SummaryRegenerationState =
  | { status: "idle"; message: string | null }
  | { status: "queueing"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const LOADING_COPY: Record<SystemLanguage, { loadFailed: string; loading: string }> = {
  en: {
    loadFailed: "Could not load summary regeneration counts.",
    loading: "Loading eligible items…"
  },
  "zh-Hans": {
    loadFailed: "无法加载可重新生成摘要的数量。",
    loading: "正在加载符合条件的条目…"
  },
  "zh-Hant": {
    loadFailed: "無法載入可重新產生摘要的數量。",
    loading: "正在載入符合條件的項目…"
  },
  ja: {
    loadFailed: "要約を再生成できる件数を読み込めませんでした。",
    loading: "対象アイテムを読み込み中…"
  },
  ko: {
    loadFailed: "요약을 다시 생성할 수 있는 항목 수를 불러오지 못했습니다.",
    loading: "대상 항목 불러오는 중…"
  }
};

export function SummaryRegenerationPanel({
  active,
  llmEnabled,
  locale
}: {
  active: boolean;
  llmEnabled: boolean;
  locale: SystemLanguage;
}) {
  const copy = getUiCopy(locale).settings;
  const statusCopy = pickLocale(locale, LOADING_COPY);
  const [counts, setCounts] = useState<SummaryRegenerationCounts | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [scope, setScope] = useState<SummaryRegenerationScope>("missing");
  const [regenerationState, setRegenerationState] = useState<SummaryRegenerationState>({ status: "idle", message: null });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const closeConfirm = useCallback(() => setIsConfirmOpen(false), []);
  useModalFocus(confirmRef, isConfirmOpen, closeConfirm);

  useEffect(() => {
    if (!active || !llmEnabled) return;
    const controller = new AbortController();

    void fetch("/api/settings/llm/regenerate-summaries", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { all?: unknown; missing?: unknown } | null;
        if (!response.ok) throw new Error("Summary regeneration counts unavailable");
        if (!controller.signal.aborted) {
          setCounts({
            all: typeof body?.all === "number" ? body.all : 0,
            missing: typeof body?.missing === "number" ? body.missing : 0
          });
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });

    return () => controller.abort();
  }, [active, llmEnabled, refreshToken]);

  const isQueueing = regenerationState.status === "queueing";
  const resolvedCounts = counts ?? { all: 0, missing: 0 };
  const selectedCount = resolvedCounts[scope];
  const canRegenerate = llmEnabled && counts !== null && !isQueueing && selectedCount > 0;

  function requestSummaryRegeneration() {
    if (selectedCount <= 0) {
      setRegenerationState({ status: "error", message: copy.regenerateSummariesEmpty });
      return;
    }

    setIsConfirmOpen(true);
  }

  async function regenerateSummaries() {
    setIsConfirmOpen(false);
    setRegenerationState({ status: "queueing", message: copy.regenerateSummariesQueueing });

    try {
      const response = await fetch("/api/settings/llm/regenerate-summaries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope })
      });
      const body = (await response.json().catch(() => null)) as { queued?: number; error?: string } | null;

      if (!response.ok) {
        throw new Error(body?.error || copy.regenerateSummariesFailed);
      }

      setRegenerationState({
        status: "success",
        message: copy.regenerateSummariesQueued(body?.queued ?? 0)
      });
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setRegenerationState({
        status: "error",
        message: error instanceof Error ? error.message : copy.regenerateSummariesFailed
      });
    }
  }

  const helpText = regenerationState.message
    ?? (loadError
      ? statusCopy.loadFailed
      : counts === null
        ? statusCopy.loading
        : copy.regenerateSummariesHelp(selectedCount));

  return (
    <section className="settingsSection settingsPanelPane settingsPanelPane--summaries">
      <h2 className="settingsPaneTitle">{copy.regenerateSummariesTitle}</h2>
      <p className="settingsIntro">{copy.regenerateSummariesIntro}</p>
      {!llmEnabled ? (
        <p className="settingsLlmMode isDisabled">{copy.llmModeDisabled}</p>
      ) : (
        <>
          <div className="summaryRegenerationChoices">
            {(["missing", "all"] as const).map((option) => (
              <label className="summaryRegenerationChoice" key={option}>
                <input
                  checked={scope === option}
                  name="summaryRegenerationScope"
                  onChange={() => {
                    setScope(option);
                    setRegenerationState({ status: "idle", message: null });
                  }}
                  type="radio"
                  value={option}
                />
                <span>
                  <strong>{copy.regenerateSummariesScope[option]}</strong>
                  <small>{counts === null ? (loadError ? statusCopy.loadFailed : statusCopy.loading) : copy.regenerateSummariesScopeHelp[option](counts[option])}</small>
                </span>
              </label>
            ))}
          </div>
          <div className={`settingsActionRow ${regenerationState.status === "success" ? "settingsActionRow--success" : regenerationState.status === "error" || loadError ? "settingsActionRow--error" : ""}`}>
            <button className="settingsAccentAction" disabled={!canRegenerate} onClick={requestSummaryRegeneration} type="button">
              {isQueueing ? <span className="settingsButtonSpinner" aria-hidden="true" /> : <RegenerateIcon />}
              <span>{isQueueing ? copy.regenerateSummariesQueueing : copy.regenerateSummaries}</span>
            </button>
            <p role={regenerationState.status === "error" || loadError ? "alert" : "status"}>
              {helpText}
            </p>
          </div>
          {isConfirmOpen ? (
            <div className="settingsConfirmDialog" ref={confirmRef} role="dialog" aria-modal="true" aria-labelledby="regenerate-summaries-title">
              <button className="settingsConfirmBackdrop" tabIndex={-1} aria-label={copy.cancel} onClick={closeConfirm} type="button" />
              <section className="settingsConfirmPanel">
                <h2 id="regenerate-summaries-title">{copy.regenerateSummariesConfirmTitle(scope)}</h2>
                <p>{copy.regenerateSummariesConfirm(selectedCount, scope)}</p>
                <div>
                  <button onClick={closeConfirm} type="button">{copy.cancel}</button>
                  <button onClick={regenerateSummaries} type="button">{copy.regenerateSummariesConfirmAction}</button>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </section>
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
