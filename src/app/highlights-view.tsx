"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { appRoute } from "@/app/app-navigation";
import { copyText } from "@/app/copy-text";
import { highlightsCopy, type HighlightColorKey } from "@/app/highlights-copy";
import { isSystemLanguage, SYSTEM_LANGUAGE_LABELS, type SystemLanguage } from "@/app/i18n";
import { snippetReadingLanguage } from "@/app/reader-language";
import type { LibraryAnnotationEntry } from "@/server/annotations";

type HighlightsViewProps = {
  initialAnnotations: LibraryAnnotationEntry[];
  locale: SystemLanguage;
};

type GroupMode = "timeline" | "article";

const COLOR_OPTIONS: { key: HighlightColorKey; swatch: string }[] = [
  { key: "yellow", swatch: "#F3D27A" },
  { key: "green", swatch: "#A9D4B2" },
  { key: "blue", swatch: "#A9C8EC" },
  { key: "red", swatch: "#EBA9A2" }
];

const INTL_LOCALE_MAP: Record<SystemLanguage, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  ja: "ja",
  ko: "ko"
};

function formatAnnotationDate(iso: string, locale: SystemLanguage) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(INTL_LOCALE_MAP[locale], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  }).format(date);
}

function formatLanguageLabel(language: string, locale: SystemLanguage) {
  if (isSystemLanguage(language)) return SYSTEM_LANGUAGE_LABELS[language];
  try {
    return new Intl.DisplayNames([INTL_LOCALE_MAP[locale]], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

function sourceDisplay(item: LibraryAnnotationEntry["item"]) {
  if (item.sourceName && item.sourceName.toLowerCase() !== "saved urls") {
    return item.sourceName;
  }
  if (item.url) {
    try {
      return new URL(item.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return item.author;
}

export function HighlightsView({ initialAnnotations, locale }: HighlightsViewProps) {
  const hCopy = highlightsCopy(locale);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [query, setQuery] = useState("");
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);
  const [selectedColor, setSelectedColor] = useState<HighlightColorKey | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>("timeline");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const noteCount = useMemo(
    () => annotations.filter((entry) => Boolean(entry.note?.trim())).length,
    [annotations]
  );

  const filteredAnnotations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return annotations.filter((entry) => {
      if (onlyWithNotes && !entry.note?.trim()) return false;
      if (selectedColor && entry.colorKey !== selectedColor) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        entry.quote,
        entry.note,
        entry.item.title,
        entry.item.author,
        entry.item.sourceName
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [annotations, onlyWithNotes, query, selectedColor]);

  const articleGroups = useMemo(() => {
    const groups = new Map<
      string,
      { item: LibraryAnnotationEntry["item"]; entries: LibraryAnnotationEntry[] }
    >();
    for (const entry of filteredAnnotations) {
      const existing = groups.get(entry.itemId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.set(entry.itemId, { item: entry.item, entries: [entry] });
      }
    }
    return Array.from(groups.values());
  }, [filteredAnnotations]);

  const hasActiveFilters = Boolean(query.trim() || onlyWithNotes || selectedColor);

  const clearFilters = () => {
    setQuery("");
    setOnlyWithNotes(false);
    setSelectedColor(null);
  };

  const startEditing = (entry: LibraryAnnotationEntry) => {
    setEditingId(entry.id);
    setNoteDraft(entry.note ?? "");
  };

  const saveNote = async (entry: LibraryAnnotationEntry) => {
    if (busyId) return;
    setBusyId(entry.id);
    const trimmed = noteDraft.trim();
    try {
      const response = await fetch(`/api/items/${entry.itemId}/annotations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotationId: entry.id, note: trimmed })
      });
      if (response.ok) {
        setAnnotations((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, note: trimmed || null } : item))
        );
        setEditingId(null);
        setNoteDraft("");
      }
    } finally {
      setBusyId(null);
    }
  };

  const removeAnnotation = async (entry: LibraryAnnotationEntry) => {
    if (busyId) return;
    setBusyId(entry.id);
    try {
      const response = await fetch(`/api/items/${entry.itemId}/annotations`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotationId: entry.id })
      });
      if (response.ok) {
        setAnnotations((current) => current.filter((item) => item.id !== entry.id));
        if (editingId === entry.id) {
          setEditingId(null);
          setNoteDraft("");
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (entry: LibraryAnnotationEntry) => {
    const parts = [entry.quote ? `“${entry.quote}”` : "", entry.note?.trim() ?? "", `— ${entry.item.title}`].filter(Boolean);
    try {
      await copyText(parts.join("\n\n"));
      setCopiedId(entry.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === entry.id ? null : current));
      }, 1600);
    } catch {
      // Ignore clipboard permission errors.
    }
  };

  const renderCard = (entry: LibraryAnnotationEntry, showArticleFooter: boolean) => {
    const isEditing = editingId === entry.id;
    const isBusy = busyId === entry.id;
    const isCopied = copiedId === entry.id;
    const source = sourceDisplay(entry.item);
    const readerHref = appRoute({
      item: entry.itemId,
      view: "highlights",
      annotation: entry.id,
      lang: entry.language
    });

    const quoteLang = snippetReadingLanguage(entry.language, entry.quote);
    const noteLang = entry.note ? snippetReadingLanguage(null, entry.note) : undefined;
    const draftLang = snippetReadingLanguage(locale, noteDraft);

    return (
      <article className="highlightCard" key={entry.id}>
        {entry.quote ? (
          <Link className="highlightQuoteLink" href={readerHref}>
            <span className="highlightQuoteBar" style={{ backgroundColor: entry.colorHex }} aria-hidden="true" />
            <p className="highlightQuoteText" lang={quoteLang}>{entry.quote}</p>
          </Link>
        ) : null}

        {isEditing ? (
          <div className="highlightEditor">
            <textarea
              autoFocus
              disabled={isBusy}
              lang={draftLang}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder={hCopy.notePlaceholder}
              value={noteDraft}
            />
            <div className="highlightEditorActions">
              <button className="highlightEditorSave" disabled={isBusy} onClick={() => saveNote(entry)} type="button">
                {isBusy ? hCopy.saving : hCopy.saveNote}
              </button>
              <button
                className="highlightEditorCancel"
                disabled={isBusy}
                onClick={() => {
                  setEditingId(null);
                  setNoteDraft("");
                }}
                type="button"
              >
                {hCopy.cancel}
              </button>
            </div>
          </div>
        ) : entry.note ? (
          <div className="highlightNoteBlock" lang={noteLang}>{entry.note}</div>
        ) : null}

        <footer className="highlightCardFooter">
          <div className="highlightSourceMeta">
            {showArticleFooter ? (
              <>
                <Link className="highlightSourceTitle" href={readerHref} title={entry.item.title}>
                  {entry.item.title}
                </Link>
                {source ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{source}</span>
                  </>
                ) : null}
              </>
            ) : null}
            {entry.language !== "original" ? (
              <span className="highlightBadge">{formatLanguageLabel(entry.language, locale)}</span>
            ) : null}
            {entry.pdfPage ? <span className="highlightBadge">{hCopy.pdfPage(entry.pdfPage)}</span> : null}
            {showArticleFooter && entry.item.archivedAt ? (
              <span className="highlightBadge">{hCopy.archivedBadge}</span>
            ) : null}
            {showArticleFooter ? <span aria-hidden="true">·</span> : null}
            <time dateTime={entry.createdAt}>{formatAnnotationDate(entry.createdAt, locale)}</time>
          </div>

          <div className="highlightCardActions">
            <button className="highlightActionButton" disabled={isBusy} onClick={() => handleCopy(entry)} type="button">
              {isCopied ? hCopy.copied : hCopy.copy}
            </button>
            <button className="highlightActionButton" disabled={isBusy} onClick={() => startEditing(entry)} type="button">
              {entry.note ? hCopy.editNote : hCopy.addNote}
            </button>
            <button
              className="highlightActionButton isDanger"
              disabled={isBusy}
              onClick={() => removeAnnotation(entry)}
              type="button"
            >
              {hCopy.remove}
            </button>
          </div>
        </footer>
      </article>
    );
  };

  return (
    <section className="libraryView">
      <header className="libraryHeading">
        <div className="libraryHeadingTitle">
          <h1>{hCopy.title}</h1>
          <p>{hCopy.subtitle}</p>
        </div>
        {annotations.length > 0 ? <span>{hCopy.countSummary(annotations.length, noteCount)}</span> : null}
      </header>

      {annotations.length > 0 ? (
        <>
          <div className={`searchShell ${query ? "hasQuery" : ""}`}>
            <span className="searchIcon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              aria-label={hCopy.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={hCopy.searchPlaceholder}
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label={hCopy.clearFilters}
                className="searchClear"
                onClick={() => setQuery("")}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ) : null}
          </div>

          <div className="highlightsControls">
            <div className="highlightsFilterGroup">
              <button
                className={`highlightsChip ${!onlyWithNotes && !selectedColor ? "isActive" : ""}`}
                onClick={() => {
                  setOnlyWithNotes(false);
                  setSelectedColor(null);
                }}
                type="button"
              >
                {hCopy.all}
              </button>
              <button
                className={`highlightsChip ${onlyWithNotes ? "isActive" : ""}`}
                onClick={() => setOnlyWithNotes((current) => !current)}
                type="button"
              >
                {hCopy.withNotes}
              </button>
              <div className="highlightsColorDots" role="group" aria-label={hCopy.label}>
                {COLOR_OPTIONS.map((option) => {
                  const active = selectedColor === option.key;
                  return (
                    <button
                      aria-label={hCopy.colors[option.key]}
                      aria-pressed={active}
                      className={`highlightsColorDot ${active ? "isActive" : ""}`}
                      key={option.key}
                      onClick={() => setSelectedColor((current) => (current === option.key ? null : option.key))}
                      title={hCopy.colors[option.key]}
                      type="button"
                    >
                      <span style={{ backgroundColor: option.swatch }} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="highlightsModeToggle" role="tablist">
              <button
                aria-selected={groupMode === "timeline"}
                className={groupMode === "timeline" ? "isActive" : ""}
                onClick={() => setGroupMode("timeline")}
                role="tab"
                type="button"
              >
                {hCopy.timeline}
              </button>
              <button
                aria-selected={groupMode === "article"}
                className={groupMode === "article" ? "isActive" : ""}
                onClick={() => setGroupMode("article")}
                role="tab"
                type="button"
              >
                {hCopy.byArticle}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {annotations.length === 0 ? (
        <div className="highlightsEmpty">
          <span className="highlightsEmptyIcon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 11-6 6v3h9l3-3" />
              <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
          </span>
          <h2>{hCopy.emptyTitle}</h2>
          <p>{hCopy.emptyDescription}</p>
        </div>
      ) : filteredAnnotations.length === 0 ? (
        <div className="highlightsEmpty">
          <h2>{hCopy.noMatchesTitle}</h2>
          <p>{hCopy.noMatchesDescription}</p>
          {hasActiveFilters ? (
            <button onClick={clearFilters} type="button">
              {hCopy.clearFilters}
            </button>
          ) : null}
        </div>
      ) : groupMode === "timeline" ? (
        <div className="highlightsTimeline">
          {filteredAnnotations.map((entry) => renderCard(entry, true))}
        </div>
      ) : (
        <div className="highlightsGroups">
          {articleGroups.map((group) => {
            const source = sourceDisplay(group.item);
            const articleHref = appRoute({ item: group.item.id, view: "highlights" });
            return (
              <section className="highlightArticleGroup" key={group.item.id}>
                <header className="highlightArticleGroupHeader">
                  <div className="highlightArticleGroupTitle">
                    <Link href={articleHref} lang={snippetReadingLanguage(null, group.item.title)}>
                      {group.item.title}
                    </Link>
                    <div className="highlightArticleGroupMeta">
                      {source ? <span>{source}</span> : null}
                      {group.item.archivedAt ? <span className="highlightBadge">{hCopy.archivedBadge}</span> : null}
                    </div>
                  </div>
                  <span className="highlightArticleGroupCount">
                    {hCopy.articleHighlightCount(group.entries.length)}
                  </span>
                </header>
                <div className="highlightArticleGroupItems">
                  {group.entries.map((entry) => renderCard(entry, false))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
