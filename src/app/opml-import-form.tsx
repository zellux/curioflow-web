"use client";

import { useMemo, useRef, useState } from "react";

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

function outlineText(outline: Element) {
  return outline.getAttribute("title") || outline.getAttribute("text") || outline.getAttribute("xmlUrl") || "Untitled feed";
}

function parseOpmlFile(xml: string) {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("This does not look like a valid OPML file.");
  }

  const seen = new Set<string>();
  return Array.from(document.querySelectorAll("outline[xmlUrl]"))
    .map((outline, index) => {
      const xmlUrl = outline.getAttribute("xmlUrl")?.trim();
      if (!xmlUrl) return null;
      const categoryOutline = outline.parentElement?.closest("outline:not([xmlUrl])");
      const category = categoryOutline ? outlineText(categoryOutline) : outline.getAttribute("category");
      const key = xmlUrl.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        id: `${index}-${key}`,
        title: outlineText(outline),
        xmlUrl,
        htmlUrl: outline.getAttribute("htmlUrl"),
        category,
        selected: true
      };
    })
    .filter((feed): feed is OpmlFeed => Boolean(feed));
}

function feedHost(feed: OpmlFeed) {
  try {
    return new URL(feed.htmlUrl || feed.xmlUrl).hostname.replace(/^www\./, "");
  } catch {
    return feed.xmlUrl;
  }
}

export function OpmlImportForm({
  importAction,
  initialError
}: {
  importAction: (formData: FormData) => Promise<void>;
  initialError?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OpmlState>({
    status: "idle",
    fileName: null,
    feeds: [],
    error: initialError ?? null
  });

  const selectedCount = state.feeds.filter((feed) => feed.selected).length;
  const allSelected = state.feeds.length > 0 && selectedCount === state.feeds.length;
  const buttonLabel = selectedCount > 0 ? `Import ${selectedCount} feed${selectedCount === 1 ? "" : "s"}` : "Select feeds to import";
  const summaryLabel = useMemo(() => {
    if (state.status !== "loaded") return "";
    return `${state.feeds.length} feeds found · ${selectedCount} selected`;
  }, [selectedCount, state]);

  async function loadFile(file: File | undefined) {
    if (!file) return;

    try {
      const feeds = parseOpmlFile(await file.text());
      setState({
        status: "loaded",
        fileName: file.name,
        feeds,
        error: feeds.length ? null : "No RSS or Atom feeds were found in this OPML file."
      });
    } catch (error) {
      setState({
        status: "idle",
        fileName: null,
        feeds: [],
        error: error instanceof Error ? error.message : "Could not read this OPML file."
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
          <strong>Drop an OPML file, or click to choose</strong>
          <small>Bulk-import every feed at once · export from Feedly, Inoreader, NetNewsWire, Reeder...</small>
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
            <button type="button" onClick={toggleAll}>{allSelected ? "Deselect all" : "Select all"}</button>
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
