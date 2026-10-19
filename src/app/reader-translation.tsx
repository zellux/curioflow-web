"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SystemLanguage } from "@/app/i18n";
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

const languageName = (language: string, locale: SystemLanguage) => language === "zh-Hans" ? (locale === "zh-Hans" ? "简体中文" : "Simplified Chinese") : "English";
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
        if (!controller.signal.aborted) setError(locale === "zh-Hans" ? "暂时无法获取翻译进度，正在重试…" : "Unable to load progress. Retrying…");
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
      if (generation.current === currentGeneration) setError(locale === "zh-Hans" ? "无法开始翻译，请检查设置中的语言模型配置后重试。" : "Could not start translation. Check the language model in Settings and retry.");
    } finally {
      if (generation.current === currentGeneration) setRequesting(false);
    }
  };

  const current = translations.find(entry => entry.language === selected && entry.status === "succeeded");
  return <TranslationContext.Provider value={{ translations, selected, select, current, locale, start, requesting, error }}>{children}</TranslationContext.Provider>;
}

export function ReaderTranslationButton() {
  const context = useContext(TranslationContext)!;
  const { translations, locale, start, requesting } = context;
  const pending = translations.find(entry => entry.language === locale && active(entry));
  const label = locale === "zh-Hans" ? "翻译" : "Translate";
  return <button type="button" className="saveToggleButton readerTranslateButton" onClick={() => void start()} disabled={requesting || Boolean(pending)}
    title={locale === "zh-Hans" ? `翻译为${languageName(locale, locale)}` : `Translate to ${languageName(locale, locale)}`}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 5h12M9 3v2M5 5c1 6 5 9 9 11M13 5C12 11 8 15 3 17M14 21l4-10 4 10M16 17h4" /></svg>
    {pending || requesting ? (locale === "zh-Hans" ? "翻译中…" : "Translating…") : label}
  </button>;
}

export function ReaderTranslationTitle({ title }: { title: string }) {
  const { current } = useContext(TranslationContext)!;
  return <h1 lang={current?.language}>{current?.title ?? title}</h1>;
}

export function ReaderTranslationBody({ html, text, tocItems, targetId }: { html: string | null; text: string; tocItems: ReaderTocItem[]; targetId: string }) {
  const { current, translations, selected, select, locale, error, start } = useContext(TranslationContext)!;
  const completed = translations.filter(entry => entry.status === "succeeded");
  const pending = translations.filter(active);
  const failed = translations.find(entry => entry.language === locale && ["failed", "cancelled"].includes(entry.status));
  const content = current?.html ?? html;
  return <>
    {translations.length > 0 || error ? <section className="readerTranslationPanel" aria-label={locale === "zh-Hans" ? "文章翻译" : "Article translation"}>
      {completed.length > 0 ? <label>
        <span>{locale === "zh-Hans" ? "阅读语言" : "Reading language"}</span>
        <select value={current ? selected : "original"} onChange={event => select(event.target.value)}>
          <option value="original">{locale === "zh-Hans" ? "原文" : "Original"}</option>
          {completed.map(entry => <option key={entry.language} value={entry.language}>{languageName(entry.language, locale)}</option>)}
        </select>
      </label> : null}
      <div role="status" aria-live="polite">
        {pending.map(entry => <p key={entry.language}>{locale === "zh-Hans" ? `正在翻译为${languageName(entry.language, locale)}` : `Translating to ${languageName(entry.language, locale)}`} · {entry.completedChunks}/{entry.totalChunks}</p>)}
        {current ? <p>{locale === "zh-Hans" ? `当前为${languageName(current.language, locale)}译文 · AI 翻译可能有误` : `${languageName(current.language, locale)} translation · AI translations may contain errors`}</p> : null}
        {failed ? <p>{locale === "zh-Hans" ? "翻译未完成，已保留进度。" : "Translation stopped. Progress is saved."} <button type="button" onClick={() => void start()}>{locale === "zh-Hans" ? "重试" : "Retry"}</button></p> : null}
        {error ? <p className="readerTranslationError">{error}</p> : null}
      </div>
    </section> : null}
    <ReaderToc key={current?.language ?? "original"} items={current?.tocItems ?? tocItems} locale={locale} targetId={targetId} />
    <div className="readerBody readerArticle" id={targetId} lang={current?.language} data-reader-language={current?.language ?? "original"}>
      {content ? <div key={current?.language ?? "original"} dangerouslySetInnerHTML={{ __html: content }} /> : text.split(/\n{2,}/).filter(part => part.trim()).map((part, index) => <p key={index}>{part.trim()}</p>)}
    </div>
  </>;
}
