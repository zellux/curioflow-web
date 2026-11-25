"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isSystemLanguage, pickLocale, SYSTEM_LANGUAGE_LABELS, type SystemLanguage } from "@/app/i18n";
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

type TranslationContextValue = {
  translations: Translation[];
  selected: string;
  select: (language: string) => void;
  current: Translation | undefined;
  locale: SystemLanguage;
  start: () => Promise<void>;
  requesting: boolean;
  error: string;
};

const TranslationContext = createContext<TranslationContextValue | null>(null);
export function useReaderLanguage() {
  return useContext(TranslationContext)?.current?.language ?? "original";
}

const TRANSLATION_COPY: Record<SystemLanguage, {
  aiDisclaimer: (lang: string) => string;
  button: string;
  original: string;
  panelAria: string;
  pollError: string;
  readingLanguage: string;
  retry: string;
  startError: string;
  stopped: string;
  translateTitle: (lang: string) => string;
  translating: string;
  translatingTo: (lang: string) => string;
}> = {
  en: {
    aiDisclaimer: (lang) => `${lang} translation · AI translations may contain errors`,
    button: "Translate",
    original: "Original",
    panelAria: "Article translation",
    pollError: "Unable to load progress. Retrying…",
    readingLanguage: "Reading language",
    retry: "Retry",
    startError: "Could not start translation. Check the language model in Settings and retry.",
    stopped: "Translation stopped. Progress is saved.",
    translateTitle: (lang) => `Translate to ${lang}`,
    translating: "Translating…",
    translatingTo: (lang) => `Translating to ${lang}`
  },
  "zh-Hans": {
    aiDisclaimer: (lang) => `当前为${lang}译文 · AI 翻译可能有误`,
    button: "翻译",
    original: "原文",
    panelAria: "文章翻译",
    pollError: "暂时无法获取翻译进度，正在重试…",
    readingLanguage: "阅读语言",
    retry: "重试",
    startError: "无法开始翻译，请检查设置中的语言模型配置后重试。",
    stopped: "翻译未完成，已保留进度。",
    translateTitle: (lang) => `翻译为${lang}`,
    translating: "翻译中…",
    translatingTo: (lang) => `正在翻译为${lang}`
  },
  "zh-Hant": {
    aiDisclaimer: (lang) => `目前為${lang}譯文 · AI 翻譯可能有誤`,
    button: "翻譯",
    original: "原文",
    panelAria: "文章翻譯",
    pollError: "暫時無法取得翻譯進度，正在重試…",
    readingLanguage: "閱讀語言",
    retry: "重試",
    startError: "無法開始翻譯，請檢查設定中的語言模型設定後重試。",
    stopped: "翻譯未完成，已保留進度。",
    translateTitle: (lang) => `翻譯為${lang}`,
    translating: "翻譯中…",
    translatingTo: (lang) => `正在翻譯為${lang}`
  },
  ja: {
    aiDisclaimer: (lang) => `${lang}訳 · AI 翻訳には誤りが含まれる場合があります`,
    button: "翻訳",
    original: "原文",
    panelAria: "記事の翻訳",
    pollError: "進捗を取得できませんでした。再試行中…",
    readingLanguage: "表示言語",
    retry: "再試行",
    startError: "翻訳を開始できませんでした。設定で言語モデルを確認して再試行してください。",
    stopped: "翻訳が中断されました。進捗は保存されています。",
    translateTitle: (lang) => `${lang}に翻訳`,
    translating: "翻訳中…",
    translatingTo: (lang) => `${lang}に翻訳中`
  },
  ko: {
    aiDisclaimer: (lang) => `${lang} 번역 · AI 번역에는 오류가 있을 수 있습니다`,
    button: "번역",
    original: "원문",
    panelAria: "글 번역",
    pollError: "진행 상황을 불러올 수 없습니다. 다시 시도 중…",
    readingLanguage: "읽기 언어",
    retry: "재시도",
    startError: "번역을 시작할 수 없습니다. 설정의 언어 모델을 확인하고 다시 시도하세요.",
    stopped: "번역이 중단되었습니다. 진행 상황은 저장되었습니다.",
    translateTitle: (lang) => `${lang}(으)로 번역`,
    translating: "번역 중…",
    translatingTo: (lang) => `${lang}(으)로 번역 중`
  }
};

const languageName = (language: string) => isSystemLanguage(language) ? SYSTEM_LANGUAGE_LABELS[language] : language;
const active = (entry: Translation) => entry.status === "queued" || entry.status === "running";

export function ReaderTranslationProvider({ itemId, locale, children }: { itemId: string; locale: SystemLanguage; children: ReactNode }) {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [selected, setSelected] = useState("original");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const autoSelect = useRef<string | null>(null);
  const generation = useRef(0);
  const selectionVersion = useRef(0);
  const endpoint = `/api/items/${encodeURIComponent(itemId)}/translations`;

  const accept = useCallback((entries: Translation[]) => {
    setTranslations(entries);
    const complete = entries.find(entry => entry.language === autoSelect.current && entry.status === "succeeded");
    if (complete) {
      setSelected(complete.language);
      autoSelect.current = null;
    }
  }, []);

  // Reading an article only loads saved translations; it never starts an LLM call.
  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = generation.current;
    void fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) {
        const data = await response.json();
        if (generation.current === requestGeneration && !controller.signal.aborted) accept(data.translations);
      }
    }).catch(() => {});
    return () => { controller.abort(); generation.current += 1; };
  }, [endpoint, accept]);

  const pending = translations.some(active);
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const requestGeneration = generation.current;
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load translation progress");
        const data = await response.json();
        if (requestGeneration === generation.current && !controller.signal.aborted) accept(data.translations);
        setError("");
      } catch {
        if (!controller.signal.aborted) setError(pickLocale(locale, TRANSLATION_COPY).pollError);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pending, endpoint, accept, locale]);

  const select = (language: string) => { selectionVersion.current += 1; autoSelect.current = null; setSelected(language); };
  const start = async () => {
    const existing = translations.find(entry => entry.language === locale && entry.status === "succeeded");
    if (existing) { select(existing.language); return; }
    if (requesting) return;
    const currentGeneration = ++generation.current;
    const currentSelectionVersion = selectionVersion.current;
    setRequesting(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("Translation request failed");
      const data = await response.json();
      if (generation.current !== currentGeneration) return;
      autoSelect.current = selectionVersion.current === currentSelectionVersion ? data.language : null;
      accept(data.translations);
    } catch {
      if (generation.current === currentGeneration) setError(pickLocale(locale, TRANSLATION_COPY).startError);
    } finally {
      if (generation.current === currentGeneration) setRequesting(false);
    }
  };

  const current = translations.find(entry => entry.language === selected && entry.status === "succeeded");
  return <TranslationContext.Provider value={{ translations, selected, select, current, locale, start, requesting, error }}>{children}</TranslationContext.Provider>;
}

export function ReaderTranslationButton({ variant = "button" }: { variant?: "button" | "menu" }) {
  const context = useContext(TranslationContext)!;
  const { translations, locale, start, requesting } = context;
  const copy = pickLocale(locale, TRANSLATION_COPY);
  const pending = translations.find(entry => entry.language === locale && active(entry));
  return <button type="button" className={variant === "menu" ? "readerMoreItem" : "saveToggleButton readerTranslateButton"} onClick={() => void start()} disabled={requesting || Boolean(pending)}
    role={variant === "menu" ? "menuitem" : undefined} data-close-menu={variant === "menu" ? "" : undefined}
    title={copy.translateTitle(languageName(locale))}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 5h12M9 3v2M5 5c1 6 5 9 9 11M13 5C12 11 8 15 3 17M14 21l4-10 4 10M16 17h4" /></svg>
    {variant === "menu" ? <span>{pending || requesting ? copy.translating : copy.button}</span> : pending || requesting ? copy.translating : copy.button}
  </button>;
}

export function ReaderTranslationTitle({ title, originalLanguage }: { title: string; originalLanguage?: string }) {
  const { current } = useContext(TranslationContext)!;
  return <h1 lang={current?.language ?? originalLanguage}>{current?.title ?? title}</h1>;
}

export function ReaderTranslationBody({ html, text, tocItems, targetId, originalLanguage }: { html: string | null; text: string; tocItems: ReaderTocItem[]; targetId: string; originalLanguage?: string }) {
  const { current, translations, selected, select, locale, error, start } = useContext(TranslationContext)!;
  const copy = pickLocale(locale, TRANSLATION_COPY);
  const completed = translations.filter(entry => entry.status === "succeeded");
  const pending = translations.filter(active);
  const failed = translations.find(entry => entry.language === locale && ["failed", "cancelled"].includes(entry.status));
  const content = current?.html ?? html;
  return <>
    {translations.length > 0 || error ? <section className="readerTranslationPanel" aria-label={copy.panelAria}>
      {completed.length > 0 ? <label>
        <span>{copy.readingLanguage}</span>
        <select value={current ? selected : "original"} onChange={event => select(event.target.value)}>
          <option value="original">{copy.original}</option>
          {completed.map(entry => <option key={entry.language} value={entry.language}>{languageName(entry.language)}</option>)}
        </select>
      </label> : null}
      <div role="status" aria-live="polite">
        {pending.map(entry => <p key={entry.language}>{copy.translatingTo(languageName(entry.language))} · {entry.completedChunks}/{entry.totalChunks}</p>)}
        {current ? <p>{copy.aiDisclaimer(languageName(current.language))}</p> : null}
        {failed ? <p>{copy.stopped} <button type="button" onClick={() => void start()}>{copy.retry}</button></p> : null}
        {error ? <p className="readerTranslationError">{error}</p> : null}
      </div>
    </section> : null}
    <ReaderToc key={current?.language ?? "original"} items={current?.tocItems ?? tocItems} locale={locale} targetId={targetId} />
    <div className="readerBody readerArticle" id={targetId} lang={current?.language ?? originalLanguage} data-reader-language={current?.language ?? "original"}>
      {content ? <div key={current?.language ?? "original"} dangerouslySetInnerHTML={{ __html: content }} /> : text.split(/\n{2,}/).filter(part => part.trim()).map((part, index) => <p key={index}>{part.trim()}</p>)}
    </div>
  </>;
}
