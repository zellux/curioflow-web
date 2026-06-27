"use client";

import { useMemo, useRef, useState } from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type OpmlFeed = {
  id: string;
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  category: string | null;
  selected: boolean;
};

type OpmlState =
  | { status: "idle"; fileName: null; feeds: OpmlFeed[]; error: string | null }
  | { status: "loaded"; fileName: string; feeds: OpmlFeed[]; error: string | null };

function outlineText(outline: Element, untitled: string) {
  return outline.getAttribute("title") || outline.getAttribute("text") || outline.getAttribute("xmlUrl") || untitled;
}

function outlineLabel(outline: Element) {
  return outline.getAttribute("title")?.trim() || outline.getAttribute("text")?.trim() || null;
}

function categoryForFolder(outline: Element, inheritedCategory: string | null, depth: number) {
  const label = outlineLabel(outline);
  if (!label) return inheritedCategory;

  const genericRootLabels = new Set(["feeds", "rss", "subscriptions", "my feeds"]);
  if (depth === 0 && genericRootLabels.has(label.toLowerCase())) return inheritedCategory;

  return label;
}

function parseOpmlFile(xml: string, copy: ReturnType<typeof getUiCopy>["opml"]) {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(copy.invalid);
  }

  const body = document.querySelector("opml > body");
  const seen = new Set<string>();
  const feeds: OpmlFeed[] = [];

  function collect(outlines: Element[], inheritedCategory: string | null, depth: number) {
    outlines.forEach((outline) => {
      const xmlUrl = outline.getAttribute("xmlUrl")?.trim();
      const ownCategory = outline.getAttribute("category")?.trim() || null;

      if (xmlUrl) {
        const key = xmlUrl.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          feeds.push({
            id: `${feeds.length}-${key}`,
            title: outlineText(outline, copy.untitled),
            xmlUrl,
            htmlUrl: outline.getAttribute("htmlUrl"),
            category: ownCategory ?? inheritedCategory,
            selected: true
          });
        }
      }

      const nextCategory = xmlUrl ? inheritedCategory : categoryForFolder(outline, inheritedCategory, depth);
      collect(Array.from(outline.children).filter((child) => child.tagName.toLowerCase() === "outline"), nextCategory, depth + 1);
    });
  }

  collect(Array.from(body?.children ?? []).filter((child) => child.tagName.toLowerCase() === "outline"), null, 0);
  return feeds;
}

function feedHost(feed: OpmlFeed) {
  try {
    const rawUrl = feed.htmlUrl || feed.xmlUrl;
    const displayUrl = rawUrl.replace(/^feed:(\/\/)?/i, "");
    return new URL(/^\/\//.test(displayUrl) ? `https:${displayUrl}` : displayUrl).hostname.replace(/^www\./, "");
  } catch {
    return feed.xmlUrl;
  }
}

export function OpmlImportForm({
  importAction,
  locale = "en",
  initialError
}: {
  importAction: (formData: FormData) => Promise<void>;
  locale?: SystemLanguage;
  initialError?: string | null;
}) {
  const copy = getUiCopy(locale).opml;
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OpmlState>({
    status: "idle",
    fileName: null,
    feeds: [],
    error: initialError ?? null
  });

  const selectedCount = state.feeds.filter((feed) => feed.selected).length;
  const allSelected = state.feeds.length > 0 && selectedCount === state.feeds.length;
  const buttonLabel = selectedCount > 0 ? copy.importFeeds(selectedCount) : copy.selectFeeds;
  const summaryLabel = useMemo(() => {
    if (state.status !== "loaded") return "";
    return copy.found(state.feeds.length, selectedCount);
  }, [copy, selectedCount, state]);

  async function loadFile(file: File | undefined) {
    if (!file) return;

    try {
      const feeds = parseOpmlFile(await file.text(), copy);
      setState({
        status: "loaded",
        fileName: file.name,
        feeds,
        error: feeds.length ? null : copy.noFeeds
      });
    } catch (error) {
      setState({
        status: "idle",
        fileName: null,
        feeds: [],
        error: error instanceof Error ? error.message : copy.readFailed
      });
    }
  }

  function toggleFeed(id: string) {
    setState((current) => ({
      ...current,
      feeds: current.feeds.map((feed) => (feed.id === id ? { ...feed, selected: !feed.selected } : feed))
    }));
  }

  function toggleAll() {
    setState((current) => ({
      ...current,
      feeds: current.feeds.map((feed) => ({ ...feed, selected: !allSelected }))
    }));
  }

  return (
    <form action={importAction} className="sourceForm opmlImportForm">
      {state.feeds
        .filter((feed) => feed.selected)
        .map((feed) => (
          <span className="opmlHiddenFields" key={feed.id}>
            <input type="hidden" name="feedUrl" value={feed.xmlUrl} />
            <input type="hidden" name="feedTitle" value={feed.title} />
            <input type="hidden" name="feedHtmlUrl" value={feed.htmlUrl ?? ""} />
            <input type="hidden" name="feedCategory" value={feed.category ?? ""} />
          </span>
        ))}

      <input
        ref={inputRef}
        className="opmlFileInput"
        id="opml-file"
        type="file"
        accept=".opml,.xml,text/xml,application/xml"
        onChange={(event) => loadFile(event.target.files?.[0])}
      />

      {state.status === "idle" ? (
        <label
          className="opmlDrop"
          htmlFor="opml-file"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            loadFile(event.dataTransfer.files[0]);
          }}
        >
          <span aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h10M4 12h16M4 18h12M18 7l2-2 2 2" />
            </svg>
          </span>
          <strong>{copy.choose}</strong>
          <small>{copy.bulkHelp}</small>
        </label>
      ) : (
        <div className="opmlListCard">
          <div className="opmlListHeader">
            <span className="opmlFileBadge" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 6h10M4 12h16M4 18h12M18 7l2-2 2 2" />
              </svg>
            </span>
            <div>
              <strong>{state.fileName}</strong>
              <small>{summaryLabel}</small>
            </div>
            <button type="button" onClick={toggleAll}>{allSelected ? copy.deselectAll : copy.selectAll}</button>
          </div>
          <div className="opmlFeedList">
            {state.feeds.map((feed) => (
              <label className="opmlFeedRow" key={feed.id}>
                <input type="checkbox" checked={feed.selected} onChange={() => toggleFeed(feed.id)} />
                <span className="opmlCheck" aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="opmlFeedText">
                  <strong>{feed.title}</strong>
                  <small>{feedHost(feed)}</small>
                </span>
                {feed.category ? <em>{feed.category}</em> : null}
              </label>
            ))}
          </div>
        </div>
      )}

      {state.error ? <div className="sourceError">{state.error}</div> : null}
      <button type="submit" disabled={selectedCount === 0}>{buttonLabel}</button>
    </form>
  );
}
