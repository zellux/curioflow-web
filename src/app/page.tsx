import Link from "next/link";
import type { Route } from "next";
import {
  archiveItemAction,
  addPodcastSourceAction,
  deleteItemAction,
  importOpmlSourcesAction,
  addRssSourceAction,
  askLibraryAction,
  saveUrlAction,
  refetchArticleContentAction,
  toggleItemSavedAction,
  unsubscribeSourceAction,
  unarchiveItemAction,
  updateLlmSettingsAction,
  updateReadStatusAction,
  uploadPdfAction
} from "@/app/actions";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtml } from "@/server/reader/rendering";
import { getLibrarySources } from "@/server/sources";
import { getOrCreateTodayBrief } from "@/server/briefs";
import { getChatThread } from "@/server/chat";
import { getLlmSettingsForCurrentAccount } from "@/server/settings";
import { getRecentDigestItems } from "@/server/digest";
import { RssSubscribeForm } from "@/app/rss-subscribe-form";
import { OpmlImportForm } from "@/app/opml-import-form";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import { ReaderHighlighter } from "@/app/reader-highlighter";
import { ReaderProgress } from "@/app/reader-progress";

type PageSearchParams = {
  add?: string;
  delete?: string;
  filter?: string;
  item?: string;
  q?: string;
  podcastError?: string;
  podcastUrl?: string;
  opmlError?: string;
  opmlFailed?: string;
  opmlImported?: string;
  rssError?: string;
  read?: string;
  rssPreview?: string;
  refetched?: string;
  settings?: string;
  source?: string;
  status?: string;
  saved?: string;
  thread?: string;
  unsubscribe?: string;
  view?: string;
};

type HomeProps = {
  searchParams?: Promise<PageSearchParams>;
};

type InboxItem = Awaited<ReturnType<typeof getInboxItems>>[number];
type Brief = Awaited<ReturnType<typeof getOrCreateTodayBrief>>;
type ChatThread = Awaited<ReturnType<typeof getChatThread>>;
type DigestItem = Awaited<ReturnType<typeof getRecentDigestItems>>[number];
type LlmSettings = Awaited<ReturnType<typeof getLlmSettingsForCurrentAccount>>;
type LibrarySource = Awaited<ReturnType<typeof getLibrarySources>>[number];
type LibraryFilter = {
  query?: string;
  sourceId?: string;
  sourceType?: string;
  readStatus?: string;
  status?: string;
  archived?: boolean;
  recentPosts?: boolean;
};
type AppView = "library" | "brief" | "ask" | "settings";
type AddSourceTab = "rss" | "podcast" | "url" | "pdf" | "opml";
type ReaderEntryContext = {
  label: string;
  query: Record<string, string | undefined>;
};
type BriefSection = {
  title: string;
  summary: string;
  citations?: Array<{ itemId: string; source: string; title: string }>;
};
type Citation = { title: string; source: string; itemId: string };
type ArticleSummary = {
  overview: string;
  points: string[];
  source: "metadata" | "full-text" | "placeholder";
};
type FetchStateItem = {
  status: string;
  type: string;
  url: string | null;
  document: {
    parserVersion: string;
    metadataJson: string;
    text: string;
  } | null;
};
type ReaderErrorCopy = {
  title: string;
  message: string;
  short: string;
};

function isArticleFetchError(item: FetchStateItem) {
  return item.type === "article" && item.document?.parserVersion === "mock-url-v1";
}

function isArticleFetching(item: FetchStateItem) {
  return item.type === "article" && item.status === "pending";
}

function fallbackReason(metadataJson: string | undefined) {
  if (!metadataJson) return null;

  try {
    const metadata = JSON.parse(metadataJson) as { fallbackReason?: unknown };
    return typeof metadata.fallbackReason === "string" ? metadata.fallbackReason : null;
  } catch {
    return null;
  }
}

function fetchErrorCopy(item: FetchStateItem): ReaderErrorCopy {
  const reason = fallbackReason(item.document?.metadataJson);
  const statusCode = reason?.match(/HTTP\s+(\d+)/i)?.[1];

  if (statusCode) {
    return {
      title: "Couldn't reach the source",
      message: `The server returned HTTP ${statusCode}. The page may be down, rate-limited, or behind a paywall.`,
      short: `Fetch failed - source returned HTTP ${statusCode}.`
    };
  }

  if (reason?.toLowerCase().includes("timed out")) {
    return {
      title: "The request timed out",
      message: "Curioflow waited without a response. The source may be slow or temporarily unreachable.",
      short: "Timed out - no response from the source."
    };
  }

  return {
    title: "Couldn't reach the source",
    message: "Curioflow couldn't retrieve the full text. The page may be down, rate-limited, or behind a paywall.",
    short: "Fetch failed - the source could not be reached."
  };
}

function formatDate(date: Date | string | null) {
  if (!date) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(date));
}

function hostnameFor(item: {
  url: string | null;
  contentObject?: { normalizedUrl: string | null } | null;
  source?: { name: string } | null;
}) {
  const url = item.contentObject?.normalizedUrl ?? item.url;
  if (!url) return item.source?.name ?? "Library";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return item.source?.name ?? "Library";
  }
}

function statusLabel(status: string) {
  if (status === "ready") return "Indexed";
  if (status === "pending") return "Queued";
  if (status === "failed") return "Needs retry";
  return status;
}

function itemKindLabel(item: { type: string; source?: { type: string } | null }) {
  if (item.type === "pdf") return "PDF";
  if (item.type === "podcast" || item.source?.type === "podcast") return "PODCAST";
  if (item.source?.type === "rss") return "FEED";
  return "URL";
}

function estimateRead(text?: string | null) {
  if (!text) return "1 min";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 240))} min`;
}

function summarize(text?: string | null) {
  if (!text) return "Queued for extraction and indexing.";
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function truncateSentence(text: string, length = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, length - 1).trim()}…`;
}

function articleParagraphs(text?: string | null) {
  if (!text) return [];
  return text.split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function readerSummary(document?: InboxItem["document"] | null): ArticleSummary {
  if (!document?.text) {
    return {
      overview: "Curioflow is still parsing the full article text. The summary will update once the document is indexed.",
      points: [],
      source: "placeholder"
    };
  }

  let metadataExcerpt = "";
  try {
    const metadata = JSON.parse(document.metadataJson) as { excerpt?: unknown; summary?: { overview?: unknown; points?: unknown } };
    if (typeof metadata.summary?.overview === "string") {
      const points = Array.isArray(metadata.summary.points)
        ? metadata.summary.points.filter((point): point is string => typeof point === "string").map((point) => truncateSentence(point, 150)).slice(0, 3)
        : [];
      return { overview: truncateSentence(metadata.summary.overview, 220), points, source: "metadata" };
    }
    metadataExcerpt = typeof metadata.excerpt === "string" ? metadata.excerpt : "";
  } catch {
    metadataExcerpt = "";
  }

  const paragraphs = articleParagraphs(document.text);
  const overview = truncateSentence(metadataExcerpt || paragraphs[0] || document.text, 220);
  const points = paragraphs
    .filter((paragraph) => paragraph !== paragraphs[0])
    .slice(0, 3)
    .map((paragraph) => truncateSentence(paragraph, 150));

  return {
    overview,
    points,
    source: metadataExcerpt ? "metadata" : "full-text"
  };
}

function PlainTextArticle({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph, index) => {
        const trimmed = paragraph.trim();
        if (!trimmed) return null;

        return <p key={index}>{trimmed}</p>;
      })}
    </>
  );
}

function parseBriefSections(brief: Brief) {
  try {
    return JSON.parse(brief.sectionsJson) as BriefSection[];
  } catch {
    return [];
  }
}

function readStatusFilter(value?: string) {
  return value && ["unread", "reading", "done"].includes(value) ? value : undefined;
}

function itemStatusFilter(value?: string) {
  return value && ["pending", "ready", "failed"].includes(value) ? value : undefined;
}

function searchFilter(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function addSourceTab(value?: string, hasRssPreview = false): AddSourceTab {
  if (hasRssPreview) return "rss";
  return value === "podcast" || value === "url" || value === "pdf" || value === "opml" ? value : "rss";
}

function buildHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  const query = search.toString();
  return query ? `/?${query}` : "/";
}

function compactQuery(params: Record<string, string | undefined>) {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value) query[key] = value;
  }
  return query;
}

function appRoute(params: Record<string, string | undefined>) {
  return {
    pathname: "/",
    query: compactQuery(params)
  };
}

function isUnfiltered(filter: LibraryFilter) {
  return !filter.query && !filter.sourceId && !filter.sourceType && !filter.readStatus && !filter.status && !filter.archived && !filter.recentPosts;
}

function libraryEntryContext(
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>
): ReaderEntryContext {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const label = filter.query
    ? "Search results"
    : filter.archived
      ? "Archive"
      : filter.recentPosts
        ? "Recent posts"
    : filter.readStatus === "unread"
      ? "Unread"
      : filter.status === "ready"
        ? "Indexed"
        : activeSource?.name ?? "Library";

  return {
    label,
    query: {
      q: filter.query,
      read: filter.readStatus,
      filter: filter.archived ? "archive" : filter.recentPosts ? "recent-posts" : undefined,
      source: filter.sourceId,
      status: filter.status
    }
  };
}

function readerEntryContext(
  params: PageSearchParams | undefined,
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>
): ReaderEntryContext {
  if (params?.view === "brief") {
    return { label: "Daily Briefing", query: { view: "brief" } };
  }

  if (params?.view === "ask") {
    return { label: "Ask your library", query: { view: "ask", thread: params.thread } };
  }

  return libraryEntryContext(filter, sources);
}

function readerItemRoute(itemId: string, entryContext: ReaderEntryContext) {
  return appRoute({ ...entryContext.query, item: itemId });
}

function RssIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="5" cy="19" r="1.6" />
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
    </svg>
  );
}

function UrlIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1" />
    </svg>
  );
}

function PdfIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 3v5h5M14 3H6v18h12V8z" />
    </svg>
  );
}

function OpmlIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 6h10M4 12h16M4 18h12M18 7l2-2 2 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h11" />
    </svg>
  );
}

function BriefIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a8 8 0 0 0 .1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L15 6.5h-4L10.6 9a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a8 8 0 0 0 .1 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2.2-1.5Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 16V4M8 8l4-4 4 4M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
    </svg>
  );
}

function ChevronDownIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ArchiveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 7h16M6 7v12h12V7M9 11h6M7 4h10l1 3H6z" />
    </svg>
  );
}

function UnarchiveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 7h16M6 7v12h12V7M12 16V10M9 13l3-3 3 3M7 4h10l1 3H6z" />
    </svg>
  );
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
    </svg>
  );
}

function AssistantAnswer({
  entryContext,
  thread
}: {
  entryContext: ReaderEntryContext;
  thread: ChatThread;
}) {
  if (!thread) return null;
  const assistant = [...thread.messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return null;

  let citations: Citation[] = [];
  try {
    citations = JSON.parse(assistant.citationsJson);
  } catch {
    citations = [];
  }

  return (
    <div className="answerCard">
      <p>{assistant.content}</p>
      {citations.length > 0 ? (
        <div>
          <strong>Sources</strong>
          {citations.map((citation) => (
            <Link href={readerItemRoute(citation.itemId, entryContext)} key={`${citation.itemId}-${citation.title}`}>
              <span>{citation.source}</span>
              {citation.title}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({
  counts,
  sources,
  activeItemId,
  filter,
  settingsHref,
  view,
  userName
}: {
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  activeItemId?: string;
  filter: LibraryFilter;
  settingsHref: Route;
  view: AppView;
  userName: string;
}) {
  const rssSources = sources.filter((source) => source.type === "rss");
  const podcastSources = sources.filter((source) => source.type === "podcast");
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const pdfCount = sources.find((source) => source.id === "manual-pdf-source")?._count.items ?? 0;
  const rssItemCount = rssSources.reduce((total, source) => total + source._count.items, 0);
  const activeClass = !activeItemId && view === "library" ? "active" : "";
  const recentPostsActiveClass = filter.recentPosts ? "active" : "";
  const archiveActiveClass = filter.archived ? "active" : "";

  return (
    <aside className="sidebar" aria-label="Library navigation">
      <Link className="brand" href="/">
        <span className="brandMark"><span /></span>
        <strong>Curioflow</strong>
      </Link>

      <Link className="addSourceButton" href="/?add=rss"><span aria-hidden="true">+</span> Add source</Link>

      <div className="sidebarScroll">
        <nav className="navList">
          <Link className={activeClass} href="/">
            <span className="navIcon"><LibraryIcon /></span>
            Library
          </Link>
          <Link className={view === "brief" ? "active" : ""} href="/?view=brief">
            <span className="navIcon"><BriefIcon /></span>
            Daily Briefing
          </Link>
          <Link className={view === "ask" ? "active" : ""} href="/?view=ask">
            <span className="navIcon"><AskIcon /></span>
            Ask your library
          </Link>
        </nav>

        <section className="sideGroup">
          <div className="sideGroupHeader">
            <span><ChevronDownIcon size={13} /> Feeds</span>
            <strong>{rssSources.length}</strong>
          </div>
          <Link className={`feedSideRow feedSideLink feedRecentLink ${recentPostsActiveClass}`} href="/?filter=recent-posts">
            <span><ClockIcon size={15} /> Recent posts</span>
            <strong>{rssItemCount}</strong>
          </Link>
          {rssSources.slice(0, 8).map((source) => (
            <div className={`feedSideRow ${filter.sourceId === source.id ? "active" : ""}`} key={source.id}>
              <Link className="feedSideLink" href={`/?source=${source.id}`}>
                <span>{source.name}</span>
                <strong className="feedSideCount">{source._count.items}</strong>
              </Link>
              <Link className="feedUnsubscribeButton" href={`/?unsubscribe=${source.id}`} title={`Unsubscribe from ${source.name}`} aria-label={`Unsubscribe from ${source.name}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </Link>
            </div>
          ))}
          {rssSources.length === 0 ? <p className="sideEmpty">No feeds yet</p> : null}
        </section>

        <section className="sideGroup">
          <h2>Podcasts</h2>
          {podcastSources.slice(0, 8).map((source) => (
            <div className={`feedSideRow ${filter.sourceId === source.id ? "active" : ""}`} key={source.id}>
              <Link className="feedSideLink" href={`/?source=${source.id}`}>
                <span>{source.name}</span>
                <strong>{source._count.items}</strong>
              </Link>
            </div>
          ))}
          {podcastSources.length === 0 ? <p className="sideEmpty">No podcasts yet</p> : null}
        </section>

        <section className="sideGroup">
          <h2>Library</h2>
          <Link className={`sideRow ${filter.sourceId === "manual-url-source" ? "active" : ""}`} href="/?source=manual-url-source">
            <span>Saved URLs</span>
            <strong>{savedUrlCount}</strong>
          </Link>
          <Link className={`sideRow ${filter.sourceId === "manual-pdf-source" ? "active" : ""}`} href="/?source=manual-pdf-source">
            <span>PDF Uploads</span>
            <strong>{pdfCount}</strong>
          </Link>
          <Link className={`sideRow ${archiveActiveClass}`} href="/?filter=archive">
            <span>Archive</span>
            <strong>{counts.archived}</strong>
          </Link>
        </section>
      </div>

      <div className="sidebarFooter">
        <div className="workspaceCard">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Local · default library</small>
          </div>
        </div>
        <Link className="sidebarSettingsButton" href={settingsHref} title="Settings" aria-label="Settings">
          <SettingsIcon />
        </Link>
      </div>
    </aside>
  );
}

function AddSourceDialog({
  activeTab,
  isOpen,
  podcastError,
  podcastUrl,
  opmlError,
  rssPreviewError,
  rssPreviewUrl
}: {
  activeTab: AddSourceTab;
  isOpen: boolean;
  podcastError: string | null;
  podcastUrl?: string;
  opmlError: string | null;
  rssPreviewError: string | null;
  rssPreviewUrl?: string;
}) {
  const closeHref = "/";
  const tabHref = (tab: AddSourceTab) => buildHref({ add: tab });

  return (
    <div className={`addDialog ${isOpen ? "open" : ""}`} id="add-source" role="dialog" aria-labelledby="add-source-title">
      <a className="addDialogBackdrop" href={closeHref} aria-label="Close add source dialog" />
      <section className="addDialogPanel">
        <header>
          <h2 id="add-source-title">Add a source</h2>
          <a href={closeHref} aria-label="Close add source dialog"><CloseIcon /></a>
        </header>
        <p>Everything you add is fetched, parsed into clean reading text, and indexed into your library.</p>

        <div className="sourceTabs" aria-label="Source types">
          <a className={activeTab === "rss" ? "active" : ""} href={tabHref("rss")}><RssIcon size={14} /> RSS</a>
          <a className={activeTab === "podcast" ? "active" : ""} href={tabHref("podcast")}><RssIcon size={14} /> Podcast</a>
          <a className={activeTab === "url" ? "active" : ""} href={tabHref("url")}><UrlIcon size={14} /> URL</a>
          <a className={activeTab === "pdf" ? "active" : ""} href={tabHref("pdf")}><PdfIcon size={14} /> PDF</a>
          <a className={activeTab === "opml" ? "active" : ""} href={tabHref("opml")}><OpmlIcon size={14} /> OPML</a>
        </div>

        <div className="sourcePanels">
          {activeTab === "rss" ? (
            <RssSubscribeForm
              initialError={rssPreviewError}
              initialUrl={rssPreviewUrl}
              subscribeAction={addRssSourceAction}
            />
          ) : null}

          {activeTab === "podcast" ? <form action={addPodcastSourceAction} className="sourceForm podcastSourceForm">
            <label htmlFor="podcast-url">Podcast RSS URL</label>
            <input id="podcast-url" name="url" type="text" inputMode="url" placeholder="Paste a podcast RSS feed URL..." defaultValue={podcastUrl ?? ""} required />
            <div className="sourcePreview">
              <div>
                <span>Podcast episodes</span>
                <strong>Transcript and analysis ready</strong>
                <small>Curioflow creates episode documents with transcript and analysis placeholders for LLM workers.</small>
              </div>
            </div>
            {podcastError ? <div className="sourceError">{podcastError}</div> : null}
            <button type="submit">Subscribe to podcast</button>
          </form> : null}

          {activeTab === "url" ? <form action={saveUrlAction} className="sourceForm urlSourceForm">
            <label htmlFor="page-url">Page URL</label>
            <input id="page-url" name="url" type="text" inputMode="url" placeholder="Paste a link to any article..." required />
            <div className="sourcePreview urlReadyPreview">
              <div>
                <span>Ready to save</span>
                <strong>Reader view ready</strong>
                <small>Curioflow strips navigation, saves clean text, and indexes it.</small>
              </div>
            </div>
            <button type="submit">Save URL</button>
          </form> : null}

          {activeTab === "pdf" ? <form action={uploadPdfAction} className="sourceForm">
            <label htmlFor="pdf-file">PDF</label>
            <div className="pdfDrop">
              <span><UploadIcon /></span>
              <strong>Choose a PDF to upload</strong>
              <small>Up to 50 MB · parsed into reading text</small>
              <input id="pdf-file" name="file" type="file" accept="application/pdf" required />
            </div>
            <button type="submit">Upload PDF</button>
          </form> : null}

          {activeTab === "opml" ? (
            <OpmlImportForm importAction={importOpmlSourcesAction} initialError={opmlError} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function UnsubscribeDialog({
  cancelHref,
  source
}: {
  cancelHref: string;
  source: LibrarySource | null;
}) {
  if (!source) return null;
  const savedItemCount = source.items.length;

  return (
    <div className="confirmDialog open" role="dialog" aria-labelledby="unsubscribe-title">
      <a className="addDialogBackdrop" href={cancelHref} aria-label="Cancel unsubscribe" />
      <section className="confirmDialogPanel">
        <h2 id="unsubscribe-title">Unsubscribe from {source.name}?</h2>
        <p>
          Curioflow will stop fetching new posts from this feed. You currently have {savedItemCount} saved article
          {savedItemCount === 1 ? "" : "s"} from it in your library.
        </p>
        <form action={unsubscribeSourceAction} className="unsubscribeForm">
          <input type="hidden" name="sourceId" value={source.id} />
          <label className="keepChoice">
            <input type="checkbox" name="keepItems" defaultChecked />
            <span aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <strong>
              Keep already-saved articles
              <small>Leave the {savedItemCount} saved article{savedItemCount === 1 ? "" : "s"} in your library, just stop the feed.</small>
            </strong>
          </label>
          <div>
            <a href={cancelHref}>Cancel</a>
            <button type="submit">Unsubscribe</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeleteItemDialog({
  cancelHref,
  item,
  returnTo
}: {
  cancelHref: string;
  item: { id: string; title: string } | null;
  returnTo: string;
}) {
  if (!item) return null;

  return (
    <div className="confirmDialog open" role="dialog" aria-labelledby="delete-item-title" aria-modal="true">
      <a className="addDialogBackdrop" href={cancelHref} aria-label="Cancel delete" />
      <section className="confirmDialogPanel deleteDialogPanel">
        <h2 id="delete-item-title">Delete this article?</h2>
        <p>
          &ldquo;{item.title}&rdquo; will be permanently removed from your library, along with its highlights and
          reading progress. This can&apos;t be undone.
        </p>
        <p className="deleteDialogHint">To keep it but hide it from your library, archive it instead.</p>
        <form action={deleteItemAction} className="deleteItemForm">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div>
            <a href={cancelHref}>Cancel</a>
            <button type="submit">Delete</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Topbar({
  isReader,
  view
}: {
  isReader: boolean;
  view: AppView;
}) {
  const label = isReader
    ? "Library / Reading"
    : view === "brief"
      ? "Daily Briefing"
      : view === "ask"
        ? "Ask your library"
        : "Library";

  return (
    <header className="topbar">
      <span>{label}</span>
      <div className="styleSwitch" aria-label="Reader style">
        <span>Style</span>
        <button className="active" type="button">Broadsheet</button>
        <button type="button">Journal</button>
        <button type="button">Quiet</button>
      </div>
    </header>
  );
}

function WarningTriangleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 9v4M12 17h.01M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function ItemCardActions({ entryContext, item }: { entryContext: ReaderEntryContext; item: InboxItem }) {
  const isArchived = Boolean(item.archivedAt);
  const deleteHref = buildHref({ ...entryContext.query, delete: item.id }) as Route;

  return (
    <div className="feedItemActions" aria-label="Article actions">
      <form action={isArchived ? unarchiveItemAction : archiveItemAction}>
        <input type="hidden" name="itemId" value={item.id} />
        <button className="feedItemActionButton" type="submit" title={isArchived ? "Unarchive article" : "Archive article"} aria-label={isArchived ? "Unarchive article" : "Archive article"}>
          {isArchived ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
        </button>
      </form>
      <Link className="feedItemActionButton isDanger" href={deleteHref} title="Delete article" aria-label="Delete article">
        <TrashIcon size={15} />
      </Link>
    </div>
  );
}

function FeedItemCard({ entryContext, item }: { entryContext: ReaderEntryContext; item: InboxItem }) {
  const href = readerItemRoute(item.id, entryContext);
  const hasFetchError = isArticleFetchError(item);
  const isFetching = isArticleFetching(item);
  const error = hasFetchError ? fetchErrorCopy(item) : null;
  const returnTo = buildHref({ ...entryContext.query, item: item.id });
  const progress = Math.max(0, Math.min(1, item.readingProgress));
  const showProgress = !hasFetchError && !isFetching && progress > 0;
  const isDone = item.readStatus === "done" || progress >= 0.995;
  const progressLabel = `${Math.round(progress * 100)}%`;
  const progressBar = showProgress ? (
    <span className="feedReadProgress" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
  ) : null;

  const body = (
    <>
      <div className="itemByline">
        <span className="tag">{itemKindLabel(item)}</span>
        <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
        <span>·</span>
        <span>{formatDate(item.createdAt)}</span>
        {item.readStatus === "unread" ? (
          <span className="unreadBadge">
            <i />
            Unread
          </span>
        ) : null}
        {showProgress && isDone ? (
          <span className="readDoneBadge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Read
          </span>
        ) : null}
        {showProgress && !isDone ? <span className="readProgressLabel">{progressLabel}</span> : null}
        <span className="readTime">{estimateRead(hasFetchError || isFetching ? null : item.document?.text)}</span>
      </div>
      <h2>{item.title}</h2>
      <p>{hasFetchError ? "Curioflow saved this article but couldn't retrieve the full text." : summarize(item.document?.text)}</p>
    </>
  );

  if (!hasFetchError && !isFetching) {
    return (
      <article className="feedItem">
        <Link className="feedItemMain" href={href}>
          {body}
        </Link>
        <ItemCardActions entryContext={entryContext} item={item} />
        {progressBar}
      </article>
    );
  }

  return (
    <article className="feedItem feedItemState">
      <Link className="feedItemMain" href={href}>
        {body}
      </Link>
      <ItemCardActions entryContext={entryContext} item={item} />
      {error ? (
        <div className="feedFetchState feedFetchState--error">
          <WarningTriangleIcon />
          <span>{error.short}</span>
          <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} returnTo={returnTo} variant="feedRetry" />
        </div>
      ) : null}
      {isFetching ? (
        <div className="feedFetchState feedFetchState--fetching">
          <span className="pulseDot" />
          <span>Fetching & indexing...</span>
        </div>
      ) : null}
      {progressBar}
    </article>
  );
}

function LibraryView({
  items,
  sources,
  counts,
  filter,
  thread,
  opmlImported,
  opmlFailed
}: {
  items: InboxItem[];
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  filter: LibraryFilter;
  thread: ChatThread;
  opmlImported?: string;
  opmlFailed?: string;
}) {
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const rssSourceCount = sources.filter((source) => source.type === "rss").length;
  const podcastSourceCount = sources.filter((source) => source.type === "podcast").length;
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const isFeedPage = activeSource?.type === "rss";
  const isArchive = Boolean(filter.archived);
  const entryContext = libraryEntryContext(filter, sources);
  const heading = filter.query
    ? `Search: ${filter.query}`
    : isArchive
      ? "Archive"
      : filter.recentPosts
        ? "Recent posts"
    : filter.readStatus === "unread"
      ? "Unread"
      : filter.readStatus === "done"
        ? "Read"
      : filter.status === "ready"
        ? "Indexed"
        : filter.status === "failed"
          ? "Failed"
        : activeSource?.name ?? "Library";
  const headingCopy = isArchive
    ? "Articles you have archived. Kept out of your library, but searchable and restorable any time."
    : filter.recentPosts
      ? "Newest posts from your subscribed feeds."
    : `${counts.ready} indexed · ${counts.unread} unread · ${counts.jobs.length} recent jobs`;

  return (
    <div className="libraryView">
      <div className="libraryHeading">
        <div>
          <h1>{heading}</h1>
          <p>{headingCopy}</p>
        </div>
        <div className="libraryHeadingActions">
          <span>{items.length} shown</span>
          {isFeedPage ? (
            <Link className="subtleActionButton" href={`/?source=${activeSource.id}&unsubscribe=${activeSource.id}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="5" cy="19" r="1.6" />
                <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M19 5 5 19" />
              </svg>
              Unsubscribe
            </Link>
          ) : null}
        </div>
      </div>

      {opmlImported ? (
        <div className="importNotice">
          <strong>{opmlImported} feed{opmlImported === "1" ? "" : "s"} imported from OPML.</strong>
          <span>
            Curioflow is fetching and indexing recent posts
            {opmlFailed ? ` · ${opmlFailed} feed${opmlFailed === "1" ? "" : "s"} failed` : ""}.
          </span>
        </div>
      ) : null}

      <form action="/" className="searchShell">
        {filter.archived ? <input type="hidden" name="filter" value="archive" /> : null}
        {filter.recentPosts ? <input type="hidden" name="filter" value="recent-posts" /> : null}
        {filter.sourceId ? <input type="hidden" name="source" value={filter.sourceId} /> : null}
        {filter.readStatus ? <input type="hidden" name="read" value={filter.readStatus} /> : null}
        {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}
        <span>⌕</span>
        <input name="q" placeholder="Search your library..." defaultValue={filter.query ?? ""} />
      </form>

      <div className="chips">
        <Link className={isUnfiltered(filter) ? "active" : ""} href="/">All</Link>
        <Link className={filter.readStatus === "unread" ? "active" : ""} href="/?read=unread">Unread</Link>
        <Link className={filter.readStatus === "done" ? "active" : ""} href="/?read=done">Read</Link>
        <Link className={filter.status === "ready" ? "active" : ""} href="/?status=ready">Indexed</Link>
        <Link className={filter.status === "failed" ? "active" : ""} href="/?status=failed">Failed</Link>
        <Link className={filter.archived ? "active" : ""} href="/?filter=archive">{counts.archived} Archive</Link>
        <Link className={filter.sourceId === "manual-url-source" ? "active" : ""} href="/?source=manual-url-source">
          {savedUrlCount} Saved URLs
        </Link>
        {filter.query ? <Link href={filter.archived ? "/?filter=archive" : filter.recentPosts ? "/?filter=recent-posts" : "/"}>Clear search</Link> : null}
        <span>{rssSourceCount} RSS feeds</span>
        <span>{podcastSourceCount} podcasts</span>
      </div>

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>{isArchive ? "No archived articles." : "Save the first article to begin."}</h2>
          </div>
        ) : (
          items.map((item) => (
            <FeedItemCard entryContext={entryContext} item={item} key={item.id} />
          ))
        )}
      </div>

      <section className="askStrip" id="ask">
        <div className="sectionHeading">
          <h2>Ask your library</h2>
          <span>Local placeholder</span>
        </div>
        <p>Searches indexed chunks and returns local citations while the real answer engine is pending.</p>
        <form action={askLibraryAction} className="askForm">
          <input name="question" placeholder="Ask anything across your library..." required />
          <button type="submit">Ask</button>
        </form>
        <AssistantAnswer entryContext={entryContext} thread={thread} />
      </section>
    </div>
  );
}

function BriefingView({
  brief,
  counts,
  digestItems,
  thread
}: {
  brief: Brief;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  digestItems: DigestItem[];
  thread: ChatThread;
}) {
  const sections = parseBriefSections(brief);
  const entryContext: ReaderEntryContext = { label: "Daily Briefing", query: { view: "brief" } };

  return (
    <article className="briefingView">
      <div className="briefingMeta">
        <span>{formatDate(brief.date)}</span>
        <strong><i />{counts.unread} new since last briefing</strong>
      </div>

      <h1>Good morning.<br />Here is what you have been thinking about.</h1>
      <p className="briefingLead">{brief.summary}</p>

      <form action={askLibraryAction} className="briefingAsk">
        <input type="hidden" name="question" value="What should I pay attention to in today's briefing?" />
        <input type="hidden" name="returnView" value="ask" />
        <button type="submit">Ask about today&apos;s briefing</button>
      </form>

      <div className="briefingSections">
        {sections.map((section, index) => (
          <section key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            {section.citations && section.citations.length > 0 ? (
              <div>
                {section.citations.map((citation) => (
                  <Link href={readerItemRoute(citation.itemId, entryContext)} key={`${section.title}-${citation.itemId}`}>
                    <small>{citation.source}</small>
                    {citation.title}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <section className="briefingDigest">
        <div className="sectionHeading">
          <h2>Recent article introductions</h2>
          <span>{digestItems.length} recent</span>
        </div>
        <div className="digestList">
          {digestItems.length === 0 ? (
            <div className="emptyState">
              <h2>Save articles to build a briefing.</h2>
            </div>
          ) : (
            digestItems.map((item) => (
              <Link href={readerItemRoute(item.id, entryContext)} className="digestItem" key={item.id}>
                <div>
                  <span className="tag">{itemKindLabel(item)}</span>
                  <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
                  <em>{formatDate(item.publishedAt ?? item.createdAt)}</em>
                </div>
                <h2>{item.title}</h2>
                <p>{summarize(item.document?.text)}</p>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="askStrip" id="ask">
        <div className="sectionHeading">
          <h2>Continue from the briefing</h2>
          <span>Local placeholder</span>
        </div>
        <p>Ask uses the same local chunk search as the library placeholder.</p>
        <form action={askLibraryAction} className="askForm">
          <input name="question" placeholder="Ask a follow-up about today..." required />
          <button type="submit">Ask</button>
        </form>
        <AssistantAnswer entryContext={entryContext} thread={thread} />
      </section>
    </article>
  );
}

function parseCitations(value: string) {
  try {
    return JSON.parse(value) as Citation[];
  } catch {
    return [];
  }
}

function AskView({ thread }: { thread: ChatThread }) {
  const entryContext: ReaderEntryContext = {
    label: "Ask your library",
    query: { view: "ask", thread: thread?.id }
  };
  const suggestions = [
    "What should I read first?",
    "What changed across my recent saves?",
    "Which sources mention attention?"
  ];

  return (
    <article className="askView">
      <header>
        <h1>Ask your library</h1>
        <p>Answers search your saved URLs, feeds, and PDFs, then return local citations you can open.</p>
      </header>

      <div className="askMessages">
        {thread ? (
          thread.messages.map((message) => {
            const citations = parseCitations(message.citationsJson);
            return (
              <div className={`askMessage ${message.role === "user" ? "isUser" : "isAssistant"}`} key={message.id}>
                {message.role === "assistant" ? <span className="askAvatar"><i /></span> : null}
                <div>
                  <p>{message.content}</p>
                  {citations.length > 0 ? (
                    <div className="askCitations">
                      <strong>Sources</strong>
                      {citations.map((citation) => (
                        <Link href={readerItemRoute(citation.itemId, entryContext)} key={`${message.id}-${citation.itemId}`}>
                          <span>{citation.source}</span>
                          {citation.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="askEmpty">
            <span className="askAvatar"><i /></span>
            <p>Ask a question to search your indexed library. This is still the local placeholder answer engine, so every response stays grounded in saved chunks.</p>
          </div>
        )}
      </div>

      <div className="askComposer">
        <div className="askSuggestions">
          {suggestions.map((suggestion) => (
            <form action={askLibraryAction} key={suggestion}>
              <input type="hidden" name="question" value={suggestion} />
              <input type="hidden" name="returnView" value="ask" />
              <button type="submit">{suggestion}</button>
            </form>
          ))}
        </div>
        <form action={askLibraryAction} className="askForm">
          <input type="hidden" name="returnView" value="ask" />
          <input name="question" placeholder="Ask anything across your library..." required />
          <button type="submit">Ask</button>
        </form>
      </div>
    </article>
  );
}

function SettingsDialog({
  closeHref,
  llmSettings,
  isOpen,
  returnTo,
  saved
}: {
  closeHref: string;
  llmSettings: LlmSettings;
  isOpen: boolean;
  returnTo: string;
  saved?: string;
}) {
  if (!isOpen) return null;
  const providers = [
    { value: "anthropic", label: "Anthropic" },
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "local", label: "Local / Ollama" }
  ];

  return (
    <div className="settingsDialog open" role="dialog" aria-labelledby="settings-title" aria-modal="true">
      <a className="settingsDialogBackdrop" href={closeHref} aria-label="Close settings" />
      <section className="settingsDialogPanel">
        <header>
          <h2 id="settings-title">Settings</h2>
          <a href={closeHref} aria-label="Close settings"><CloseIcon /></a>
        </header>
        <div className="settingsKicker">Language model</div>
        <p className="settingsIntro">
          Curioflow uses this model to write your daily briefing, generate article summaries, and answer questions across your library.
          Keys are stored locally on this device.
        </p>
        {saved === "llm" ? <p className="settingsSaved">LLM settings saved.</p> : null}
        <form action={updateLlmSettingsAction} className="settingsForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="settingsField">
            <span>Provider</span>
            <div className="providerChoices">
              {providers.map((provider) => (
                <label className="providerChoice" key={provider.value}>
                  <input type="radio" name="provider" value={provider.value} defaultChecked={llmSettings.provider === provider.value} />
                  <span>{provider.label}</span>
                </label>
              ))}
            </div>
          </div>
          <label>
            <span>Model</span>
            <select name="model" defaultValue={llmSettings.model}>
              <option value={llmSettings.model}>{llmSettings.model}</option>
              <option value="claude-sonnet-4">claude-sonnet-4</option>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
              <option value="gpt-5-mini">gpt-5-mini</option>
              <option value="llama3.1">llama3.1</option>
            </select>
          </label>
          <label>
            <span>API key</span>
            <input name="apiKey" type="password" placeholder={llmSettings.hasApiKey ? "Saved key hidden · enter a new key to replace it" : "sk-..."} />
          </label>
          <details className="settingsAdvanced">
            <summary>Advanced · custom endpoint & embeddings</summary>
            <label>
              <span>Base URL</span>
              <input name="baseUrl" type="url" defaultValue={llmSettings.baseUrl} placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>Embedding model</span>
              <input name="embeddingModel" placeholder="voyage-3" />
            </label>
          </details>
          <div className="settingsMeta">
            <a href={closeHref}>Cancel</a>
            <span>{llmSettings.updatedAt ? `Updated ${formatDate(llmSettings.updatedAt)}` : "Using defaults until saved"}</span>
            <button type="submit">Save settings</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReaderSummaryCard({ summary }: { summary: ArticleSummary }) {
  return (
    <section className={`readerSummaryCard ${summary.source === "placeholder" ? "isPending" : ""}`} aria-label="Article summary">
      <header>
        <span className="summaryMark"><span /></span>
        <strong>Summary</strong>
        <span>·</span>
        <em>{summary.source === "placeholder" ? "waiting for full text" : "generated from the full text"}</em>
      </header>
      <p>{summary.overview}</p>
      {summary.points.length > 0 ? (
        <ul>
          {summary.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReaderView({
  backContext,
  item,
  items,
  refetched
}: {
  backContext: ReaderEntryContext;
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
  refetched?: string;
}) {
  if (!item) return null;

  const readerHtml = sanitizeArticleHtml(item.document?.articleHtml);
  const summary = readerSummary(item.document);
  const extractionNote = getExtractionNote(item.document?.metadataJson);
  const hasFetchError = isArticleFetchError(item);
  const isFetching = isArticleFetching(item);
  const error = hasFetchError ? fetchErrorCopy(item) : null;
  const source = hostnameFor(item);
  const related = items.filter((other) => other.id !== item.id && other.savedToLibrary).slice(0, 3);
  const readerBodyId = `reader-body-${item.id}`;
  const returnTo = buildHref({ ...backContext.query, item: item.id });
  const deleteHref = buildHref({ ...backContext.query, item: item.id, delete: item.id }) as Route;
  const annotations = item.annotations.map((annotation) => ({
    id: annotation.id,
    quote: annotation.quote,
    note: annotation.note,
    locationJson: annotation.locationJson,
    createdAt: annotation.createdAt.toISOString()
  }));

  return (
    <article className="readerView">
      <div className="readerToolbar">
        <Link href={appRoute(backContext.query)} className="backLink">‹ {backContext.label}</Link>
        <div>
          <ReaderHighlighter annotations={annotations} itemId={item.id} itemTitle={item.title} targetId={readerBodyId} />
          {item.type === "article" && item.url ? (
            <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} returnTo={returnTo} />
          ) : null}
          <form action={item.archivedAt ? unarchiveItemAction : archiveItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button className="readerIconButton" type="submit" title={item.archivedAt ? "Unarchive article" : "Archive article"} aria-label={item.archivedAt ? "Unarchive article" : "Archive article"}>
              {item.archivedAt ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
            </button>
          </form>
          <Link className="readerIconButton isDanger" href={deleteHref} title="Delete article" aria-label="Delete article">
            <TrashIcon size={15} />
          </Link>
          <form action={toggleItemSavedAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="savedToLibrary" value={item.savedToLibrary ? "false" : "true"} />
            <button className={`saveToggleButton ${item.savedToLibrary ? "isSaved" : ""}`} type="submit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill={item.savedToLibrary ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M6 4h12v17l-6-4-6 4Z" />
              </svg>
              {item.savedToLibrary ? "Saved" : "Save"}
            </button>
          </form>
          <form action={updateReadStatusAction} className="statusControls">
            <input type="hidden" name="itemId" value={item.id} />
            {["unread", "reading", "done"].map((status) => (
              <button
                className={item.readStatus === status ? "isActive" : ""}
                key={status}
                name="readStatus"
                type="submit"
                value={status}
              >
                {status === "done" ? "Done" : status[0].toUpperCase() + status.slice(1)}
              </button>
            ))}
          </form>
        </div>
      </div>

      <div className="readerMeta">
        <span className="tag">{itemKindLabel(item)}</span>
        <strong>{source}</strong>
        <span>·</span>
        <span>{formatDate(item.createdAt)}</span>
      </div>

      <h1>{item.title}</h1>

      <div className="readerSubhead">
        <span>By <strong>{item.author ?? source}</strong></span>
        <span>{estimateRead(item.document?.text)} · {statusLabel(item.status)}</span>
      </div>

      {hasFetchError && error ? (
        <section className="readerFetchCard readerFetchCard--error" aria-label="Article fetch failed">
          <div className="readerFetchIcon">
            <WarningTriangleIcon size={24} />
          </div>
          <h2>{error.title}</h2>
          <p>{error.message}</p>
          <div className="readerFetchActions">
            <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} returnTo={returnTo} variant="readerRetry" />
            {item.url ? (
              <a className="readerFetchOrigin" href={item.url} target="_blank" rel="noreferrer">
                Open original
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {isFetching ? (
        <section className="readerFetchCard readerFetchCard--fetching" aria-label="Article fetch in progress">
          <div className="readerFetchSpinner">
            <span className="pulseDot" />
            <span>fetching, parsing & indexing...</span>
          </div>
          <p>Retrieving the full text from the source. This usually takes a few seconds.</p>
        </section>
      ) : null}

      {!hasFetchError && !isFetching ? (
        <>
          <ReaderSummaryCard summary={summary} />

          {extractionNote ? (
            <div className="extractionNote">
              {extractionNote}
            </div>
          ) : null}
          {refetched === "article" ? (
            <div className="refetchNotice">Article content was refetched and parsed.</div>
          ) : null}

          <div className="readerBody readerArticle" id={readerBodyId}>
            {readerHtml ? (
              <div dangerouslySetInnerHTML={{ __html: readerHtml }} />
            ) : (
              <PlainTextArticle text={item.document?.text ?? "This item is still waiting for a document."} />
            )}
          </div>

          <ReaderProgress
            initialProgress={item.readingProgress}
            initialPositionJson={item.readingPositionJson}
            initialReadStatus={item.readStatus}
            itemId={item.id}
            targetId={readerBodyId}
          />

          {item.url ? (
            <a className="originButton" href={item.url} target="_blank" rel="noreferrer">
              Open original
            </a>
          ) : null}
        </>
      ) : null}

      <section className="relatedBlock">
        <h2>Related in your library</h2>
        {related.length === 0 ? (
          <p>No related saves yet.</p>
        ) : (
          related.map((relatedItem) => (
            <Link href={readerItemRoute(relatedItem.id, backContext)} key={relatedItem.id}>
              <span>{hostnameFor(relatedItem)}</span>
              <strong>{relatedItem.title}</strong>
              <em>{estimateRead(relatedItem.document?.text)}</em>
            </Link>
          ))
        )}
      </section>
    </article>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const view: AppView =
    params?.view === "brief" || params?.view === "digest"
      ? "brief"
      : params?.view === "ask"
          ? "ask"
          : "library";
  const activeAddTab = addSourceTab(params?.add, Boolean(params?.rssPreview));
  const archivedFilter = params?.filter === "archive" || params?.view === "archive";
  const recentPostsFilter = params?.filter === "recent-posts";
  const libraryFilterParam = archivedFilter ? "archive" : recentPostsFilter ? "recent-posts" : undefined;
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    sourceType: recentPostsFilter ? "rss" : undefined,
    readStatus: readStatusFilter(params?.read),
    status: itemStatusFilter(params?.status),
    archived: archivedFilter,
    recentPosts: recentPostsFilter
  };
  const [user, library, items, readerItem, counts, sources, brief, thread, llmSettings, digestItems] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(filter),
    getItemForReader(params?.item),
    getDashboardCounts(),
    getLibrarySources(),
    getOrCreateTodayBrief(),
    getChatThread(params?.thread),
    getLlmSettingsForCurrentAccount(),
    getRecentDigestItems()
  ]);
  const rssPreviewError: string | null = searchFilter(params?.rssError) ?? null;
  const rssPreviewUrl = searchFilter(params?.rssPreview);
  const podcastError: string | null = searchFilter(params?.podcastError) ?? null;
  const podcastUrl = searchFilter(params?.podcastUrl);
  const opmlError: string | null = searchFilter(params?.opmlError) ?? null;
  const unsubscribeSource = params?.unsubscribe
    ? sources.find((source) => source.id === params.unsubscribe && source.type === "rss") ?? null
    : null;
  const unsubscribeCancelHref = buildHref({
    filter: libraryFilterParam,
    q: params?.q,
    read: params?.read,
    source: params?.source,
    status: params?.status,
    view: params?.view && params.view !== "archive" ? params.view : undefined
  });

  const isReader = Boolean(readerItem);
  const backContext = readerEntryContext(params, filter, sources);
  const baseQuery = {
    item: params?.item,
    q: params?.q,
    read: params?.read,
    filter: libraryFilterParam,
    refetched: params?.refetched,
    source: params?.source,
    status: params?.status,
    thread: params?.thread,
    view: params?.view && params.view !== "settings" && params.view !== "archive" ? params.view : undefined
  };
  const settingsCloseHref = buildHref(baseQuery);
  const settingsHref = buildHref({ ...baseQuery, settings: "1" }) as Route;
  const settingsOpen = params?.settings === "1" || params?.view === "settings";
  const deleteItem =
    params?.delete
      ? [readerItem, ...items].find((item) => item?.id === params.delete) ?? null
      : null;
  const deleteCancelHref = buildHref(baseQuery);
  const deleteReturnTo = readerItem?.id === deleteItem?.id ? buildHref(backContext.query) : deleteCancelHref;

  return (
    <main className="appShell">
      <Sidebar counts={counts} sources={sources} activeItemId={readerItem?.id} filter={filter} settingsHref={settingsHref} view={view} userName={user.displayName} />

      <section className="mainShell" aria-label={library.name}>
        <Topbar isReader={isReader} view={view} />
        <div className="scrollArea">
          {readerItem ? (
            <ReaderView backContext={backContext} item={readerItem} items={items} refetched={params?.refetched} />
          ) : view === "brief" ? (
            <BriefingView brief={brief} counts={counts} digestItems={digestItems} thread={thread} />
          ) : view === "ask" ? (
            <AskView thread={thread} />
          ) : (
            <LibraryView
              items={items}
              sources={sources}
              counts={counts}
              filter={filter}
              thread={thread}
              opmlImported={params?.opmlImported}
              opmlFailed={params?.opmlFailed}
            />
          )}
        </div>
      </section>
      <AddSourceDialog
        activeTab={activeAddTab}
        isOpen={Boolean(params?.add || params?.rssPreview)}
        podcastError={podcastError}
        podcastUrl={podcastUrl}
        opmlError={opmlError}
        rssPreviewError={rssPreviewError}
        rssPreviewUrl={rssPreviewUrl}
      />
      <UnsubscribeDialog cancelHref={unsubscribeCancelHref} source={unsubscribeSource} />
      <DeleteItemDialog cancelHref={deleteCancelHref} item={deleteItem} returnTo={deleteReturnTo} />
      <SettingsDialog
        closeHref={settingsCloseHref}
        isOpen={settingsOpen}
        llmSettings={llmSettings}
        returnTo={settingsCloseHref}
        saved={params?.saved}
      />
    </main>
  );
}
