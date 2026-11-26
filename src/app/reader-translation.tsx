"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isSystemLanguage, pickLocale, SYSTEM_LANGUAGE_LABELS, SYSTEM_LANGUAGES, type SystemLanguage } from "@/app/i18n";
import { useReaderMoreMenu } from "@/app/reader-more-menu";
import { ReaderToc } from "@/app/reader-toc";
import type { ReaderTocItem } from "@/server/reader/rendering";

type Translation = {
  language: string;
  status: string;
  completedChunks: number;
  totalChunks: number;
  title: string | null;
  html: string | null;
  tocItems: ReaderTocItem[];
};

type TranslationsResponse = {
  language?: string;
  translations?: Translation[];
  targetLanguages?: string[];
};

type TranslationContextValue = {
  translations: Translation[];
  targetLanguages: string[];
  readingLanguages: string[];
  selected: string;
  select: (language: string) => void;
  current: Translation | undefined;
  locale: SystemLanguage;
  start: (language?: string) => Promise<void>;
  requestingLanguage: string | null;
  requestedLanguage: string | null;
  isTranslating: boolean;
  error: string;
};

const TranslationContext = createContext<TranslationContextValue | null>(null);
export function useReaderLanguage() {
  return useContext(TranslationContext)?.current?.language ?? "original";
}

const TRANSLATION_COPY: Record<SystemLanguage, {
  aiDisclaimer: (lang: string) => string;
  original: string;
  panelAria: string;
  pollError: string;
  queued: (lang: string) => string;
  readingLanguage: string;
  readyToRead: string;
  retry: string;
  retryTranslation: string;
  startError: string;
  starting: (lang: string) => string;
  stopped: (lang: string) => string;
  translateArticle: string;
  translating: string;
  translatingTo: (lang: string) => string;
}> = {
  en: {
    aiDisclaimer: (lang) => `${lang} translation · AI translations may contain errors`,
    original: "Original",
    panelAria: "Article translation",
    pollError: "Unable to load progress. Retrying…",
    queued: (lang) => `${lang} translation queued`,
    readingLanguage: "Reading language",
    readyToRead: "Ready to read",
    retry: "Retry",
    retryTranslation: "Retry translation",
    startError: "Could not start translation. Check the language model in Settings and retry.",
    starting: (lang) => `Starting ${lang} translation…`,
    stopped: (lang) => `${lang} translation stopped. Progress is saved.`,
    translateArticle: "Translate article",
    translating: "Translating…",
    translatingTo: (lang) => `Translating to ${lang}`
  },
  "zh-Hans": {
    aiDisclaimer: (lang) => `当前为${lang}译文 · AI 翻译可能有误`,
    original: "原文",
    panelAria: "文章翻译",
    pollError: "暂时无法获取翻译进度，正在重试…",
    queued: (lang) => `${lang}翻译已加入队列`,
    readingLanguage: "阅读语言",
    readyToRead: "已翻译",
    retry: "重试",
    retryTranslation: "重试翻译",
    startError: "无法开始翻译，请检查设置中的语言模型配置后重试。",
    starting: (lang) => `正在开始${lang}翻译…`,
    stopped: (lang) => `${lang}翻译未完成，已保留进度。`,
    translateArticle: "翻译文章",
    translating: "翻译中…",
    translatingTo: (lang) => `正在翻译为${lang}`
  },
  "zh-Hant": {
    aiDisclaimer: (lang) => `目前為${lang}譯文 · AI 翻譯可能有誤`,
    original: "原文",
    panelAria: "文章翻譯",
    pollError: "暫時無法取得翻譯進度，正在重試…",
    queued: (lang) => `${lang}翻譯已加入佇列`,
    readingLanguage: "閱讀語言",
    readyToRead: "已翻譯",
    retry: "重試",
    retryTranslation: "重試翻譯",
    startError: "無法開始翻譯，請檢查設定中的語言模型設定後重試。",
    starting: (lang) => `正在開始${lang}翻譯…`,
    stopped: (lang) => `${lang}翻譯未完成，已保留進度。`,
    translateArticle: "翻譯文章",
    translating: "翻譯中…",
    translatingTo: (lang) => `正在翻譯為${lang}`
  },
  ja: {
    aiDisclaimer: (lang) => `${lang}訳 · AI 翻訳には誤りが含まれる場合があります`,
    original: "原文",
    panelAria: "記事の翻訳",
    pollError: "進捗を取得できませんでした。再試行中…",
    queued: (lang) => `${lang}への翻訳を待機中`,
    readingLanguage: "読む言語",
    readyToRead: "翻訳済み",
    retry: "再試行",
    retryTranslation: "翻訳を再試行",
    startError: "翻訳を開始できませんでした。設定で言語モデルを確認して再試行してください。",
    starting: (lang) => `${lang}への翻訳を開始しています…`,
    stopped: (lang) => `${lang}への翻訳が中断されました。進捗は保存されています。`,
    translateArticle: "記事を翻訳",
    translating: "翻訳中…",
    translatingTo: (lang) => `${lang}に翻訳中`
  },
  ko: {
    aiDisclaimer: (lang) => `${lang} 번역 · AI 번역에는 오류가 있을 수 있습니다`,
    original: "원문",
    panelAria: "글 번역",
    pollError: "진행 상황을 불러올 수 없습니다. 다시 시도 중…",
    queued: (lang) => `${lang} 번역 대기 중`,
    readingLanguage: "읽기 언어",
    readyToRead: "번역 완료",
    retry: "재시도",
    retryTranslation: "번역 다시 시도",
    startError: "번역을 시작할 수 없습니다. 설정의 언어 모델을 확인하고 다시 시도하세요.",
    starting: (lang) => `${lang} 번역을 시작하는 중…`,
    stopped: (lang) => `${lang} 번역이 중단되었습니다. 진행 상황은 저장되었습니다.`,
    translateArticle: "글 번역하기",
    translating: "번역 중…",
    translatingTo: (lang) => `${lang}(으)로 번역 중`
  }
};

function languageName(language: string, locale: SystemLanguage) {
  if (isSystemLanguage(language)) return SYSTEM_LANGUAGE_LABELS[language];
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

// Short interval: translations now finish in a few seconds, so slow polling dominated perceived latency.
const TRANSLATION_POLL_MS = 500;
const TRANSLATION_POLL_ERROR_MS = 2000;
const isReadyEntry = (entry?: Translation) => entry?.status === "succeeded";
const isPendingEntry = (entry?: Translation) => entry?.status === "queued" || entry?.status === "running";
const isRetryableEntry = (entry?: Translation) => entry?.status === "failed" || entry?.status === "cancelled";

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`readerLanguageChevron${expanded ? " isExpanded" : ""}`}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="readerLanguageCheck" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ReaderTranslationProvider({ itemId, locale, children }: { itemId: string; locale: SystemLanguage; children: ReactNode }) {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<string[]>(() => [...SYSTEM_LANGUAGES]);
  const [selected, setSelected] = useState("original");
  const [requestingLanguage, setRequestingLanguage] = useState<string | null>(null);
  const [requestedLanguage, setRequestedLanguage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const autoSelect = useRef<string | null>(null);
  const generation = useRef(0);
  const selectionVersion = useRef(0);
  const endpoint = `/api/items/${encodeURIComponent(itemId)}/translations`;

  const accept = useCallback((data: TranslationsResponse) => {
    const entries = Array.isArray(data.translations) ? data.translations : [];
    setTranslations(entries);
    if (Array.isArray(data.targetLanguages)) {
      setTargetLanguages(data.targetLanguages.filter((lang): lang is string => typeof lang === "string"));
    }
    const complete = entries.find(entry => entry.language === autoSelect.current && isReadyEntry(entry));
    if (complete) {
      setSelected(complete.language);
      autoSelect.current = null;
      return;
    }
    setSelected(current => {
      if (current === "original") return current;
      return entries.some(entry => entry.language === current && isReadyEntry(entry)) ? current : "original";
    });
  }, []);

  // Reading an article only loads saved translations; it never starts an LLM call.
  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = generation.current;
    void fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) {
        const data = (await response.json()) as TranslationsResponse;
        if (generation.current === requestGeneration && !controller.signal.aborted) accept(data);
      }
    }).catch(() => {});
    return () => { controller.abort(); generation.current += 1; };
  }, [endpoint, accept]);

  const pending = translations.some(isPendingEntry);
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = TRANSLATION_POLL_MS;
      try {
        const requestGeneration = generation.current;
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load translation progress");
        const data = (await response.json()) as TranslationsResponse;
        if (requestGeneration === generation.current && !controller.signal.aborted) accept(data);
        setError("");
      } catch {
        if (!controller.signal.aborted) setError(pickLocale(locale, TRANSLATION_COPY).pollError);
        delay = TRANSLATION_POLL_ERROR_MS;
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, TRANSLATION_POLL_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pending, endpoint, accept, locale]);

  const select = useCallback((language: string) => {
    selectionVersion.current += 1;
    autoSelect.current = null;
    setSelected(language);
  }, []);

  const start = useCallback(async (targetLanguage?: string) => {
    const requested = targetLanguage ?? locale;
    const existing = translations.find(entry => entry.language === requested && isReadyEntry(entry));
    if (existing) {
      select(existing.language);
      return;
    }
    if (requestingLanguage !== null || translations.some(isPendingEntry)) return;
    const currentGeneration = ++generation.current;
    const currentSelectionVersion = selectionVersion.current;
    setRequestingLanguage(requested);
    setRequestedLanguage(requested);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: requested })
      });
      if (!response.ok) throw new Error("Translation request failed");
      const data = (await response.json()) as TranslationsResponse;
      if (generation.current !== currentGeneration) return;
      const startedLanguage = typeof data.language === "string" ? data.language : requested;
      setRequestedLanguage(startedLanguage);
      autoSelect.current = selectionVersion.current === currentSelectionVersion ? startedLanguage : null;
      accept(data);
    } catch {
      if (generation.current === currentGeneration) setError(pickLocale(locale, TRANSLATION_COPY).startError);
    } finally {
      if (generation.current === currentGeneration) setRequestingLanguage(null);
    }
  }, [accept, endpoint, locale, requestingLanguage, select, translations]);

  const readyLanguages = useMemo(
    () => translations.filter(isReadyEntry).map(entry => entry.language),
    [translations]
  );

  const readingLanguages = useMemo(
    () => [...targetLanguages, ...readyLanguages.filter(lang => !targetLanguages.includes(lang))],
    [targetLanguages, readyLanguages]
  );

  const current = translations.find(entry => entry.language === selected && isReadyEntry(entry));
  const isTranslating = requestingLanguage !== null || pending;

  return (
    <TranslationContext.Provider
      value={{
        translations,
        targetLanguages,
        readingLanguages,
        selected,
        select,
        current,
        locale,
        start,
        requestingLanguage,
        requestedLanguage,
        isTranslating,
        error
      }}
    >
      {children}
    </TranslationContext.Provider>
  );
}

function ReaderLanguageOptions({ closeMenu }: { closeMenu?: () => void }) {
  const {
    translations,
    readingLanguages,
    current,
    locale,
    select,
    start,
    requestingLanguage,
    isTranslating
  } = useContext(TranslationContext)!;
  const copy = pickLocale(locale, TRANSLATION_COPY);
  const isOriginalSelected = !current;

  return (
    <>
      <button
        type="button"
        className={`readerMoreItem readerLanguageOption${isOriginalSelected ? " isSelected" : ""}`}
        role="menuitemradio"
        aria-checked={isOriginalSelected}
        data-close-menu=""
        onClick={() => {
          select("original");
          closeMenu?.();
        }}
      >
        <span className="readerLanguageOptionBody">
          <span className="readerLanguageName">{copy.original}</span>
        </span>
        {isOriginalSelected ? <CheckIcon /> : null}
      </button>

      {readingLanguages.map(language => {
        const entry = translations.find(item => item.language === language);
        const ready = isReadyEntry(entry);
        const pending = isPendingEntry(entry) || requestingLanguage === language;
        const canRetry = isRetryableEntry(entry);
        const selected = current?.language === language;
        const disabled = !ready && isTranslating;

        let subtitle = copy.translateArticle;
        let statusClass = "readerLanguageStatus";
        if (ready) {
          subtitle = copy.readyToRead;
          statusClass = "readerLanguageStatus isReady";
        } else if (pending) {
          subtitle = entry && entry.totalChunks > 0
            ? `${copy.translating} · ${Math.min(entry.totalChunks, Math.max(0, entry.completedChunks))}/${entry.totalChunks}`
            : copy.translating;
          statusClass = "readerLanguageStatus isPending";
        } else if (canRetry) {
          subtitle = copy.retryTranslation;
          statusClass = "readerLanguageStatus isRetry";
        }

        return (
          <button
            key={language}
            type="button"
            className={`readerMoreItem readerLanguageOption${selected ? " isSelected" : ""}${pending ? " isTranslating" : ""}`}
            role="menuitemradio"
            aria-checked={selected}
            disabled={disabled}
            data-close-menu=""
            onClick={() => {
              if (ready) {
                select(language);
              } else {
                void start(language);
              }
              closeMenu?.();
            }}
          >
            <span className="readerLanguageOptionBody">
              <span className="readerLanguageName">{languageName(language, locale)}</span>
              <span className={statusClass}>
                {ready ? <span className="readerLanguageReadyDot" aria-hidden="true" /> : null}
                {subtitle}
              </span>
            </span>
            {selected ? <CheckIcon /> : null}
          </button>
        );
      })}
    </>
  );
}

export function ReaderTranslationButton({ variant = "button" }: { variant?: "button" | "menu" }) {
  const context = useContext(TranslationContext)!;
  const moreMenu = useReaderMoreMenu();
  const { current, locale, isTranslating } = context;
  const copy = pickLocale(locale, TRANSLATION_COPY);
  const [expanded, setExpanded] = useState(false);
  const submenuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (moreMenu && !moreMenu.open) setExpanded(false);
  }, [moreMenu]);

  useEffect(() => {
    if (variant !== "button" || !expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [variant, expanded]);

  const activeBadge = isTranslating
    ? copy.translating
    : current
      ? languageName(current.language, locale)
      : null;

  if (variant === "menu") {
    return (
      <div className="readerLanguageMenuGroup">
        <button
          type="button"
          className={`readerMoreItem readerLanguageTrigger${expanded ? " isExpanded" : ""}`}
          role="menuitem"
          aria-expanded={expanded}
          aria-controls={submenuId}
          onClick={() => setExpanded(open => !open)}
        >
          <GlobeIcon />
          <span className="readerLanguageTriggerLabel">{copy.readingLanguage}</span>
          {activeBadge ? (
            <span className={`readerLanguageBadge${isTranslating ? " isPending" : ""}`}>{activeBadge}</span>
          ) : null}
          <ChevronIcon expanded={expanded} />
        </button>
        {expanded ? (
          <div id={submenuId} className="readerLanguageSubmenu" role="group" aria-label={copy.readingLanguage}>
            <ReaderLanguageOptions />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="readerMore readerLanguagePopover" ref={rootRef}>
      <button
        type="button"
        className="saveToggleButton readerTranslateButton"
        aria-expanded={expanded}
        aria-controls={submenuId}
        aria-haspopup="menu"
        onClick={() => setExpanded(open => !open)}
      >
        <GlobeIcon />
        <span>{activeBadge ?? copy.readingLanguage}</span>
        <ChevronIcon expanded={expanded} />
      </button>
      <div
        id={submenuId}
        className={`readerMoreMenu${expanded ? " isOpen" : ""}`}
        aria-hidden={!expanded}
        inert={!expanded}
        role="menu"
      >
        <ReaderLanguageOptions closeMenu={() => setExpanded(false)} />
      </div>
    </div>
  );
}

export function ReaderTranslationTitle({ title, originalLanguage }: { title: string; originalLanguage?: string }) {
  const { current } = useContext(TranslationContext)!;
  return <h1 lang={current?.language ?? originalLanguage}>{current?.title ?? title}</h1>;
}

export function ReaderTranslationBody({ html, text, tocItems, targetId, originalLanguage }: { html: string | null; text: string; tocItems: ReaderTocItem[]; targetId: string; originalLanguage?: string }) {
  const {
    current,
    translations,
    selected,
    select,
    locale,
    error,
    start,
    requestingLanguage,
    requestedLanguage
  } = useContext(TranslationContext)!;
  const copy = pickLocale(locale, TRANSLATION_COPY);
  const completed = translations.filter(isReadyEntry);
  const pending = translations.filter(isPendingEntry);
  const statusEntry = pending[pending.length - 1]
    ?? (requestedLanguage ? translations.find(entry => entry.language === requestedLanguage) : undefined)
    ?? translations[translations.length - 1];
  const failed = statusEntry && isRetryableEntry(statusEntry) ? statusEntry : undefined;
  const showPanel = Boolean(requestingLanguage || pending.length > 0 || current || failed || error);
  const content = current?.html ?? html;

  return <>
    {showPanel ? <section className="readerTranslationPanel" aria-label={copy.panelAria}>
      {current && completed.length > 0 ? <label>
        <span>{copy.readingLanguage}</span>
        <select value={selected} onChange={event => select(event.target.value)}>
          <option value="original">{copy.original}</option>
          {completed.map(entry => <option key={entry.language} value={entry.language}>{languageName(entry.language, locale)}</option>)}
        </select>
      </label> : null}
      <div role="status" aria-live="polite">
        {requestingLanguage && !pending.some(entry => entry.language === requestingLanguage) ? (
          <p>{copy.starting(languageName(requestingLanguage, locale))}</p>
        ) : null}
        {pending.map(entry => {
          const total = entry.totalChunks;
          const done = Math.min(total, Math.max(0, entry.completedChunks));
          const lang = languageName(entry.language, locale);
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <div key={entry.language} className="readerTranslationProgress">
              <p>
                <span>{entry.status === "queued" && total === 0 ? copy.queued(lang) : copy.translatingTo(lang)}</span>
                {total > 0 ? <span className="readerTranslationCount">{done}/{total}</span> : null}
              </p>
              {total > 0 ? (
                <div className="readerTranslationProgressTrack" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
        {current ? <p>{copy.aiDisclaimer(languageName(current.language, locale))}</p> : null}
        {failed ? (
          <p>
            {copy.stopped(languageName(failed.language, locale))}{" "}
            <button type="button" onClick={() => void start(failed.language)}>{copy.retry}</button>
          </p>
        ) : null}
        {error ? (
          <p className="readerTranslationError">
            {error}
            {requestedLanguage && !pending.length && !requestingLanguage ? (
              <>{" "}<button type="button" onClick={() => void start(requestedLanguage)}>{copy.retry}</button></>
            ) : null}
          </p>
        ) : null}
      </div>
    </section> : null}
    <ReaderToc key={current?.language ?? "original"} items={current?.tocItems ?? tocItems} locale={locale} targetId={targetId} />
    <div className="readerBody readerArticle" id={targetId} lang={current?.language ?? originalLanguage} data-reader-language={current?.language ?? "original"}>
      {content ? <div key={current?.language ?? "original"} dangerouslySetInnerHTML={{ __html: content }} /> : text.split(/\n{2,}/).filter(part => part.trim()).map((part, index) => <p key={index}>{part.trim()}</p>)}
    </div>
  </>;
}
