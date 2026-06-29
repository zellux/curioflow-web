import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import {
  archiveItemAction,
  addPodcastSourceAction,
  importOpmlSourcesAction,
  logoutAction,
  addRssSourceAction,
  askLibraryAction,
  regenerateArticleSummaryAction,
  saveUrlAction,
  refetchArticleContentAction,
  toggleItemSavedAction,
  unarchiveItemAction,
  updateLlmSettingsAction,
  uploadPdfAction
} from "@/app/actions";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtmlWithToc } from "@/server/reader/rendering";
import { getLibrarySources } from "@/server/sources";
import { getOrCreateTodayBrief } from "@/server/briefs";
import { getChatThread } from "@/server/chat";
import { getLlmSettingsForCurrentAccount } from "@/server/settings";
import { getRecentDigestItems } from "@/server/digest";
import { displayLanguageForSummary, readLlmSummaryFromMetadata, type SummaryDisplayLanguage } from "@/server/summary-metadata";
import { DeleteItemButton, UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import { RegenerateSummaryForm } from "@/app/regenerate-summary-form";
import { ReaderHighlighter } from "@/app/reader-highlighter";
import { ReaderProgress } from "@/app/reader-progress";
import { ReaderToc } from "@/app/reader-toc";
import { JobStatusRefresh } from "@/app/job-status-refresh";
import { SummaryScrollRestorer } from "@/app/summary-scroll-restorer";
import { FeedSidebarSection } from "@/app/feed-sidebar-section";
import { FeedSaveForm } from "@/app/feed-save-form";
import { ReadingStyleSettings } from "@/app/reading-style-settings";
import { LlmSettingsFields } from "@/app/llm-settings-fields";
import { AddSourceButton, AddSourceDialog } from "@/app/add-source-dialog";
import { getUiCopy, normalizeSystemLanguage, type SystemLanguage, type UiCopy } from "@/app/i18n";
import { appHref } from "@/app/routes";

export type PageSearchParams = {
  add?: string;
  filter?: string;
  item?: string;
  page?: string;
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
  sourceKind?: string;
  status?: string;
  summary?: string;
  saved?: string;
  thread?: string;
  view?: string;
};

export type HomeProps = {
  searchParams?: Promise<PageSearchParams>;
};

type CurioflowHomeProps = HomeProps & {
  routeParams?: PageSearchParams;
};

type InboxPage = Awaited<ReturnType<typeof getInboxItems>>;
type InboxItem = InboxPage["items"][number];
type Brief = Awaited<ReturnType<typeof getOrCreateTodayBrief>>;
type ChatThread = Awaited<ReturnType<typeof getChatThread>>;
type DigestItem = Awaited<ReturnType<typeof getRecentDigestItems>>[number];
type LlmSettings = Awaited<ReturnType<typeof getLlmSettingsForCurrentAccount>>;

const APP_HOME = "/app" as Route;

type LibraryFilter = {
  query?: string;
  sourceId?: string;
  sourceType?: string;
  status?: string;
  archived?: boolean;
  recentPosts?: boolean;
  page?: number;
};
type AppView = "library" | "brief" | "ask" | "settings";
type AddSourceTab = "url" | "pdf" | "rss" | "opml" | "podcast";
type ReaderEntryContext = {
  label: string;
  query: Record<string, string | undefined>;
};
type ItemActionState = {
  archivedAt: Date | string | null;
  savedToLibrary: boolean;
  sourceId: string | null;
  source?: { type: string } | null;
};
type BriefSection = {
  title: string;
  summary: string;
  points?: string[];
  citations?: Array<{ itemId: string; source: string; title: string }>;
};
type Citation = { title: string; source: string; itemId: string };
type ArticleSummary = {
  overview: string;
  points: string[];
  source: "metadata" | "llm" | "full-text" | "placeholder" | "pending" | "failed";
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

function isSummaryGenerationPending(metadataJson: string | null | undefined) {
  if (!metadataJson) return false;

  try {
    const metadata = JSON.parse(metadataJson) as { summaryStatus?: unknown };
    return metadata.summaryStatus === "pending";
  } catch {
    return false;
  }
}

function fetchErrorCopy(item: FetchStateItem, copy: UiCopy): ReaderErrorCopy {
  const reason = fallbackReason(item.document?.metadataJson);
  const statusCode = reason?.match(/HTTP\s+(\d+)/i)?.[1];

  if (statusCode) {
    return {
      title: copy.item.fetchFailedTitle,
      message: copy.item.httpFetchMessage(statusCode),
      short: copy.item.httpFetchShort(statusCode)
    };
  }

  if (reason?.toLowerCase().includes("timed out")) {
    return {
      title: copy.item.fetchTimedOutTitle,
      message: copy.item.fetchTimedOutMessage,
      short: copy.item.fetchTimedOutShort
    };
  }

  return {
    title: copy.item.fetchFailedTitle,
    message: copy.item.fetchFailedMessage,
    short: copy.item.fetchFailedShort
  };
}

function formatDate(date: Date | string | null, locale: SystemLanguage = "en", noDate = "No date") {
  if (!date) return noDate;
  return new Intl.DateTimeFormat(locale, {
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

function statusLabel(status: string, copy: UiCopy) {
  if (status === "ready") return copy.common.indexed;
  if (status === "pending") return copy.common.queued;
  if (status === "failed") return copy.item.needsRetry;
  return status;
}

function itemKindLabel(item: { type: string; source?: { type: string } | null }, copy: UiCopy) {
  if (item.type === "pdf") return copy.item.kind.pdf;
  if (item.type === "podcast" || item.source?.type === "podcast") return copy.item.kind.podcast;
  if (item.source?.type === "rss") return copy.item.kind.feed;
  return copy.item.kind.url;
}

function estimateRead(text?: string | null, locale: SystemLanguage = "en") {
  if (!text) return locale === "zh-Hans" ? "1 分钟" : "1 min";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 240));
  return locale === "zh-Hans" ? `${minutes} 分钟` : `${minutes} min`;
}

function summarize(text: string | null | undefined, copy: UiCopy) {
  if (!text) return copy.item.queuedSummary;
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function digestSummary(document: DigestItem["document"] | null | undefined, copy: UiCopy) {
  const summary = readLlmSummaryFromMetadata(document?.metadataJson);
  return summary ?? { language: null, overview: summarize(document?.text, copy), points: [] };
}

function briefingLanguageForDigestItems(digestItems: DigestItem[]): SummaryDisplayLanguage {
  const counts = digestItems.reduce(
    (total, item) => {
      const language = displayLanguageForSummary(readLlmSummaryFromMetadata(item.document?.metadataJson));
      if (language) total[language] += 1;
      return total;
    },
    { en: 0, "zh-Hans": 0 }
  );

  return counts["zh-Hans"] > counts.en ? "zh-Hans" : "en";
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

function readerSummary(document: InboxItem["document"] | null | undefined, copy: UiCopy): ArticleSummary {
  if (!document?.text) {
    return {
      overview: copy.item.parsingSummary,
      points: [],
      source: "placeholder"
    };
  }

  let metadataExcerpt = "";
  try {
    const metadata = JSON.parse(document.metadataJson) as {
      excerpt?: unknown;
      summarySource?: unknown;
      summaryStatus?: unknown;
      summary?: { overview?: unknown; points?: unknown };
    };
    if (metadata.summaryStatus === "pending") {
      return {
        overview: copy.item.summaryGenerating,
        points: [],
        source: "pending"
      };
    }

    if (metadata.summaryStatus === "failed" && metadata.summarySource !== "llm") {
      return {
        overview: copy.item.summaryFailed,
        points: [],
        source: "failed"
      };
    }

    if (typeof metadata.summary?.overview === "string") {
      const points = Array.isArray(metadata.summary.points)
        ? metadata.summary.points.filter((point): point is string => typeof point === "string").map((point) => truncateSentence(point, 150)).slice(0, 3)
        : [];
      return { overview: truncateSentence(metadata.summary.overview, 220), points, source: metadata.summarySource === "llm" ? "llm" : "metadata" };
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

function itemStatusFilter(value?: string) {
  return value && ["pending", "ready", "failed"].includes(value) ? value : undefined;
}

function searchFilter(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pageFilter(value?: string) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 1 ? page : 1;
}

function addSourceTab(value?: string, hasRssPreview = false): AddSourceTab {
  if (hasRssPreview) return "rss";
  return value === "podcast" || value === "url" || value === "pdf" || value === "opml" || value === "rss" ? value : "url";
}

function buildHref(params: Record<string, string | undefined>) {
  return appHref(params);
}

function localeAria(copy: UiCopy, english: string, chinese: string) {
  return copy.locale === "zh-Hans" ? chinese : english;
}

function appRoute(params: Record<string, string | undefined>) {
  return appHref(params) as Route;
}

function isUnfiltered(filter: LibraryFilter) {
  return !filter.query && !filter.sourceId && !filter.sourceType && !filter.status && !filter.archived && !filter.recentPosts;
}

function libraryEntryContext(
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>,
  copy: UiCopy
): ReaderEntryContext {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const activeSourceKind = activeSource?.type === "rss" ? "feed" : activeSource?.type === "podcast" ? "podcast" : undefined;
  const label = filter.query
    ? copy.common.searchResults
    : filter.archived
      ? copy.nav.archive
      : filter.recentPosts
        ? copy.sidebar.recentPosts
      : filter.status === "ready"
        ? copy.common.indexed
        : activeSource?.name ?? copy.nav.library;

  return {
    label,
    query: {
      q: filter.query,
      filter: filter.archived ? "archive" : filter.recentPosts ? "recent-posts" : undefined,
      page: filter.page && filter.page > 1 ? String(filter.page) : undefined,
      source: filter.sourceId,
      sourceKind: activeSourceKind,
      status: filter.status
    }
  };
}

function readerEntryContext(
  params: PageSearchParams | undefined,
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>,
  copy: UiCopy
): ReaderEntryContext {
  if (params?.view === "brief") {
    return { label: copy.nav.briefing, query: { view: "brief" } };
  }

  if (params?.view === "ask") {
    return { label: copy.nav.ask, query: { view: "ask", thread: params.thread } };
  }

  return libraryEntryContext(filter, sources, copy);
}

function readerItemRoute(itemId: string, entryContext: ReaderEntryContext) {
  return appRoute({ ...entryContext.query, item: itemId });
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.85" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.52a2 2 0 0 1-1 1.72l-.15.1a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.52a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
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
  copy,
  entryContext,
  thread
}: {
  copy: UiCopy;
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
          <strong>{copy.ask.sources}</strong>
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
  copy,
  locale,
  sources,
  activeItemId,
  filter,
  settingsHref,
  view,
  userName
}: {
  copy: UiCopy;
  locale: SystemLanguage;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  activeItemId?: string;
  filter: LibraryFilter;
  settingsHref: Route;
  view: AppView;
  userName: string;
}) {
  const rssSources = sources.filter((source) => source.type === "rss");
  const podcastSources = sources.filter((source) => source.type === "podcast");
  const rssItemCount = rssSources.reduce((total, source) => total + source._count.items, 0);
  const pdfSource = sources.find((source) => source.type === "pdf");
  const pdfCount = pdfSource?._count.items ?? 0;
  const activeClass = !activeItemId && view === "library" && isUnfiltered(filter) ? "active" : "";
  const recentPostsActiveClass = filter.recentPosts ? "active" : "";

  return (
    <aside className="sidebar" aria-label={copy.nav.library}>
      <Link className="brand" href={APP_HOME}>
        <Image className="brandMark" src="/curioflow-logo.png?v=20260629-2" alt="" width={28} height={28} aria-hidden="true" priority unoptimized />
        <strong className="brandName">Curio<span>flow</span></strong>
      </Link>

      <AddSourceButton label={copy.nav.addSource} />

      <nav className="navList">
        <Link className={activeClass} href={APP_HOME}>
          <span className="navIcon"><LibraryIcon /></span>
          {copy.nav.library}
        </Link>
        <Link className={view === "brief" ? "active" : ""} href="/briefing">
          <span className="navIcon"><BriefIcon /></span>
          {copy.nav.briefing}
        </Link>
        <Link className={view === "ask" ? "active" : ""} href="/ask">
          <span className="navIcon"><AskIcon /></span>
          {copy.nav.ask}
        </Link>
        <Link className={filter.archived ? "active" : ""} href="/archive">
          <span className="navIcon"><ArchiveIcon /></span>
          {copy.nav.archive}
        </Link>
      </nav>

      <div className="sidebarScroll">
        <FeedSidebarSection
          activeSourceId={filter.sourceId}
          locale={locale}
          recentPostsActive={Boolean(recentPostsActiveClass)}
          sources={rssSources.map((source) => ({ id: source.id, name: source.name, category: source.category, status: source.status, itemCount: source._count.items }))}
          totalItemCount={rssItemCount}
        />

        <section className="sideGroup">
          <h2>{copy.sidebar.podcasts}</h2>
          {podcastSources.slice(0, 8).map((source) => (
            <div className={`feedSideRow ${filter.sourceId === source.id ? "active" : ""}`} key={source.id}>
              <Link className="feedSideLink" href={appRoute({ source: source.id, sourceKind: "podcast" })}>
                <span>{source.name}</span>
                <strong>{source._count.items}</strong>
              </Link>
            </div>
          ))}
          {podcastSources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noPodcasts}</p> : null}
        </section>

        <section className="sideGroup">
          <h2>{copy.sidebar.library}</h2>
          <Link className={`sideRow ${pdfSource && filter.sourceId === pdfSource.id ? "active" : ""}`} href={pdfSource ? appRoute({ source: pdfSource.id }) : appRoute({ source: "manual-pdf-source" })}>
            <span>{copy.sidebar.pdfUploads}</span>
            <strong>{pdfCount}</strong>
          </Link>
        </section>
      </div>

      <div className="sidebarFooter">
        <div className="workspaceCard">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{copy.sidebar.personalWorkspace}</strong>
            <small>{copy.sidebar.workspaceMeta}</small>
          </div>
        </div>
        <Link className="sidebarSettingsButton" href={settingsHref} title={copy.nav.settings} aria-label={copy.nav.settings}>
          <SettingsIcon />
        </Link>
        <form action={logoutAction}>
          <button className="sidebarSettingsButton" type="submit" title="Logout" aria-label="Logout">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" />
              <path d="M3 12h12M12 9l3 3-3 3" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}

function WarningTriangleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 9v4M12 17h.01M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function isSourceStreamActionContext(item: ItemActionState, entryContext: ReaderEntryContext) {
  if (item.source?.type !== "rss" && item.source?.type !== "podcast") return false;
  if (entryContext.query.filter === "recent-posts") return true;
  return Boolean(item.sourceId && entryContext.query.source === item.sourceId);
}

function itemShowsSaveAction(item: ItemActionState, entryContext: ReaderEntryContext) {
  if (item.archivedAt) return false;
  return !item.savedToLibrary || isSourceStreamActionContext(item, entryContext);
}

function itemShowsArchiveAction(item: ItemActionState, entryContext: ReaderEntryContext) {
  if (item.archivedAt) return true;
  if (item.source?.type === "rss" && isSourceStreamActionContext(item, entryContext)) return true;
  return item.savedToLibrary && !itemShowsSaveAction(item, entryContext);
}

function ItemCardActions({ copy, entryContext, item, locale }: { copy: UiCopy; entryContext: ReaderEntryContext; item: InboxItem; locale: SystemLanguage }) {
  const isArchived = Boolean(item.archivedAt);
  const showSave = itemShowsSaveAction(item, entryContext);
  const showArchive = itemShowsArchiveAction(item, entryContext);
  const deleteReturnTo = buildHref(entryContext.query);

  return (
    <div className="feedItemActions" aria-label={copy.common.articleActions}>
      {showSave ? (
        <FeedSaveForm itemId={item.id} locale={locale} />
      ) : null}
      {showArchive ? (
        <form action={isArchived ? unarchiveItemAction : archiveItemAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <button className="feedItemActionButton" type="submit" title={isArchived ? (locale === "zh-Hans" ? "取消归档文章" : "Unarchive article") : (locale === "zh-Hans" ? "归档文章" : "Archive article")} aria-label={isArchived ? (locale === "zh-Hans" ? "取消归档文章" : "Unarchive article") : (locale === "zh-Hans" ? "归档文章" : "Archive article")}>
            {isArchived ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
          </button>
        </form>
      ) : null}
      <DeleteItemButton className="feedItemActionButton isDanger" itemId={item.id} itemTitle={item.title} locale={locale} returnTo={deleteReturnTo}>
        <TrashIcon size={15} />
      </DeleteItemButton>
    </div>
  );
}

function FeedItemCard({ copy, entryContext, item, locale }: { copy: UiCopy; entryContext: ReaderEntryContext; item: InboxItem; locale: SystemLanguage }) {
  const href = readerItemRoute(item.id, entryContext);
  const hasFetchError = isArticleFetchError(item);
  const isFetching = isArticleFetching(item);
  const error = hasFetchError ? fetchErrorCopy(item, copy) : null;
  const returnTo = buildHref({ ...entryContext.query, item: item.id });
  const progress = Math.max(0, Math.min(1, item.readingProgress));
  const showProgress = !hasFetchError && !isFetching && progress > 0;
  const progressLabel = `${Math.round(progress * 100)}%`;
  const progressBar = showProgress ? (
    <span className="feedReadProgress" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
  ) : null;

  const body = (
    <>
      <div className="itemByline">
        <span className="tag">{itemKindLabel(item, copy)}</span>
        <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
        <span className="itemDateDivider">·</span>
        <span className="itemDate">{formatDate(item.publishedAt ?? item.createdAt, locale, copy.common.noDate)}</span>
        {showProgress ? <span className="readProgressLabel">{progressLabel}</span> : null}
        <span className="readTime">{estimateRead(hasFetchError || isFetching ? null : item.document?.text, locale)}</span>
      </div>
      <h2>{item.title}</h2>
      <p>{hasFetchError ? copy.item.articleFetchFailed : summarize(item.document?.text, copy)}</p>
    </>
  );

  if (!hasFetchError && !isFetching) {
    return (
      <article className="feedItem">
        <Link className="feedItemMain" href={href}>
          {body}
        </Link>
        <ItemCardActions copy={copy} entryContext={entryContext} item={item} locale={locale} />
        {progressBar}
      </article>
    );
  }

  return (
    <article className="feedItem feedItemState">
      <Link className="feedItemMain" href={href}>
        {body}
      </Link>
      <ItemCardActions copy={copy} entryContext={entryContext} item={item} locale={locale} />
      {error ? (
        <div className="feedFetchState feedFetchState--error">
          <WarningTriangleIcon />
          <span>{error.short}</span>
          <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} locale={locale} returnTo={returnTo} variant="feedRetry" />
        </div>
      ) : null}
      {isFetching ? (
        <div className="feedFetchState feedFetchState--fetching">
          <span className="pulseDot" />
          <span>{copy.common.fetchIndexing}</span>
        </div>
      ) : null}
      {progressBar}
    </article>
  );
}

function PaginationControls({
  copy,
  entryContext,
  pagination
}: {
  copy: UiCopy;
  entryContext: ReaderEntryContext;
  pagination: Pick<InboxPage, "page" | "pageCount" | "pageSize" | "total">;
}) {
  if (pagination.total === 0) return null;

  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.total, pagination.page * pagination.pageSize);
  const pageHref = (page: number) => buildHref({
    ...entryContext.query,
    page: page > 1 ? String(page) : undefined
  }) as Route;

  return (
    <nav className="paginationControls" aria-label={localeAria(copy, "Article pages", "文章分页")}>
      <span>
        {copy.locale === "zh-Hans" ? `${start}-${end}，共 ${pagination.total}` : `${start}-${end} of ${pagination.total}`}
      </span>
      <div>
        {pagination.page > 1 ? (
          <Link href={pageHref(pagination.page - 1)}>{copy.common.previous}</Link>
        ) : (
          <span aria-disabled="true">{copy.common.previous}</span>
        )}
        <strong>{copy.locale === "zh-Hans" ? `第 ${pagination.page} 页 / 共 ${pagination.pageCount} 页` : `Page ${pagination.page} of ${pagination.pageCount}`}</strong>
        {pagination.page < pagination.pageCount ? (
          <Link href={pageHref(pagination.page + 1)}>{copy.common.next}</Link>
        ) : (
          <span aria-disabled="true">{copy.common.next}</span>
        )}
      </div>
    </nav>
  );
}

function LibraryView({
  copy,
  items,
  locale,
  sources,
  filter,
  pagination,
  opmlImported,
  opmlFailed
}: {
  copy: UiCopy;
  items: InboxItem[];
  locale: SystemLanguage;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  filter: LibraryFilter;
  pagination: Pick<InboxPage, "page" | "pageCount" | "pageSize" | "total">;
  opmlImported?: string;
  opmlFailed?: string;
}) {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const isFeedPage = activeSource?.type === "rss";
  const isRssAtomStream = filter.recentPosts || isFeedPage;
  const isArchive = Boolean(filter.archived);
  const importingFeedCount = sources.filter((source) => source.type === "rss" && source.status === "importing").length;
  const entryContext = libraryEntryContext({ ...filter, page: pagination.page }, sources, copy);
  const filterRoute = {
    filter: filter.archived ? "archive" : filter.recentPosts ? "recent-posts" : undefined,
    source: filter.sourceId,
    status: filter.status
  };
  const searchAction = buildHref(filterRoute);
  const heading = filter.query
    ? copy.library.search(filter.query)
    : isArchive
      ? copy.nav.archive
      : filter.recentPosts
        ? copy.sidebar.recentPosts
      : filter.status === "ready"
        ? copy.common.indexed
        : filter.status === "failed"
          ? copy.common.failed
        : activeSource?.name ?? copy.nav.library;
  const headingCopy = isArchive
    ? copy.library.archiveCopy
    : filter.recentPosts
      ? copy.library.feedCopy
    : copy.library.libraryCopy;

  return (
    <div className="libraryView">
      <div className="libraryHeading">
        <div>
          <h1>{heading}</h1>
          <p>{headingCopy}</p>
        </div>
        <div className="libraryHeadingActions">
          <span>{copy.library.shownTotal(items.length, pagination.total)}</span>
          {isFeedPage ? (
            <UnsubscribeSourceButton
              className="subtleActionButton"
              itemCount={activeSource._count.items}
              locale={locale}
              sourceId={activeSource.id}
              sourceName={activeSource.name}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="5" cy="19" r="1.6" />
                <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M19 5 5 19" />
              </svg>
              {copy.library.unsubscribe}
            </UnsubscribeSourceButton>
          ) : null}
        </div>
      </div>

      {opmlImported || importingFeedCount > 0 ? (
        <div className="importNotice">
          <strong>{opmlImported ? copy.library.importQueued(opmlImported) : copy.library.importQueued(String(importingFeedCount))}</strong>
          <span>
            {copy.library.importing}
            {opmlFailed ? ` · ${copy.library.importFailed(opmlFailed)}` : ""}.
          </span>
        </div>
      ) : null}

      {!isRssAtomStream ? (
        <>
          <form action={searchAction} className="searchShell">
            <span>⌕</span>
            <input name="q" placeholder={copy.library.searchPlaceholder} defaultValue={filter.query ?? ""} />
          </form>

          <div className="chips">
            <Link className={isUnfiltered(filter) ? "active" : ""} href={APP_HOME}>{copy.common.all}</Link>
            <Link className={filter.status === "failed" ? "active" : ""} href="/status/failed">{copy.common.failed}</Link>
            {filter.query ? <Link href={searchAction}>{copy.common.clearSearch}</Link> : null}
            <span>{copy.library.rssFeeds}</span>
            <span>{copy.library.podcast}</span>
          </div>
        </>
      ) : null}

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>{isArchive ? copy.library.emptyArchive : copy.library.emptyLibrary}</h2>
          </div>
        ) : (
          items.map((item) => (
            <FeedItemCard copy={copy} entryContext={entryContext} item={item} key={item.id} locale={locale} />
          ))
        )}
      </div>

      <PaginationControls copy={copy} entryContext={entryContext} pagination={pagination} />
    </div>
  );
}

function BriefingView({
  brief,
  copy,
  counts,
  digestItems,
  thread
}: {
  brief: Brief;
  copy: UiCopy;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  digestItems: DigestItem[];
  thread: ChatThread;
}) {
  const sections = parseBriefSections(brief);
  const briefLanguage = briefingLanguageForDigestItems(digestItems);
  const briefingCopy = getUiCopy(briefLanguage);
  const entryContext: ReaderEntryContext = { label: copy.nav.briefing, query: { view: "brief" } };

  return (
    <article className="briefingView">
      <div className="briefingMeta">
        <span>{formatDate(brief.date, briefLanguage, briefingCopy.common.noDate)}</span>
        <strong><i />{briefingCopy.briefing.newSinceLast(counts.unread)}</strong>
      </div>

      <h1>{briefingCopy.briefing.greeting}<br />{briefingCopy.briefing.subtitle}</h1>
      <p className="briefingLead">{brief.summary}</p>

      <div className="briefingSections">
        {sections.map((section, index) => (
          <section key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            {section.points && section.points.length > 0 ? (
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
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
          <h2>{briefingCopy.briefing.digestTitle}</h2>
          <span>{briefingCopy.briefing.recent(digestItems.length)}</span>
        </div>
        <div className="digestList">
          {digestItems.length === 0 ? (
            <div className="emptyState">
              <h2>{copy.briefing.empty}</h2>
            </div>
          ) : (
            digestItems.map((item) => {
              const summary = digestSummary(item.document, copy);

              return (
                <Link href={readerItemRoute(item.id, entryContext)} className="digestItem" key={item.id}>
                  <div>
                    <span className="tag">{itemKindLabel(item, briefingCopy)}</span>
                    <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
                    <em>{formatDate(item.publishedAt ?? item.createdAt, briefLanguage, briefingCopy.common.noDate)}</em>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{summary.overview}</p>
                  {summary.points.length > 0 ? (
                    <ul>
                      {summary.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="askStrip" id="ask">
        <div className="sectionHeading">
          <h2>{briefingCopy.ask.continueFromBriefing}</h2>
          <span>{briefingCopy.ask.localPlaceholder}</span>
        </div>
        <p>{briefingCopy.ask.briefingDescription}</p>
        <form action={askLibraryAction} className="askForm">
          <input name="question" placeholder={briefingCopy.ask.followUpPlaceholder} required />
          <button type="submit">{briefingCopy.ask.ask}</button>
        </form>
        <AssistantAnswer copy={copy} entryContext={entryContext} thread={thread} />
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

function AskView({ copy, thread }: { copy: UiCopy; thread: ChatThread }) {
  const entryContext: ReaderEntryContext = {
    label: copy.nav.ask,
    query: { view: "ask", thread: thread?.id }
  };
  const suggestions = copy.ask.suggestions;

  return (
    <article className="askView">
      <header>
        <h1>{copy.ask.title}</h1>
        <p>{copy.ask.subtitle}</p>
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
                      <strong>{copy.ask.sources}</strong>
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
            <p>{copy.ask.empty}</p>
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
          <input name="question" placeholder={copy.ask.placeholder} required />
          <button type="submit">{copy.ask.ask}</button>
        </form>
      </div>
    </article>
  );
}

function SettingsDialog({
  closeHref,
  copy,
  locale,
  llmSettings,
  isOpen,
  returnTo,
  saved
}: {
  closeHref: string;
  copy: UiCopy;
  locale: SystemLanguage;
  llmSettings: LlmSettings;
  isOpen: boolean;
  returnTo: string;
  saved?: string;
}) {
  if (!isOpen) return null;

  return (
    <div className="settingsDialog open" role="dialog" aria-labelledby="settings-title" aria-modal="true">
      <a className="settingsDialogBackdrop" href={closeHref} aria-label={copy.settings.close} />
      <section className="settingsDialogPanel">
        <header>
          <h2 id="settings-title">{copy.settings.title}</h2>
          <a href={closeHref} aria-label={copy.settings.close}><CloseIcon /></a>
        </header>
        <section className="settingsSection">
          <div className="settingsKicker">{copy.settings.readingStyle}</div>
          <p className="settingsIntro">{copy.settings.readingStyleIntro}</p>
          <ReadingStyleSettings locale={locale} />
        </section>
        {saved === "llm" ? <p className="settingsSaved">{copy.settings.llmSaved}</p> : null}
        <form action={updateLlmSettingsAction} className="settingsForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <LlmSettingsFields
            hasApiKey={llmSettings.hasApiKey}
            initialBaseUrl={llmSettings.baseUrl}
            initialModel={llmSettings.model}
            initialProvider={llmSettings.provider}
            locale={locale}
            initialSummaryLanguage={llmSettings.summaryLanguage}
            initialSystemLanguage={llmSettings.systemLanguage}
          />
          <div className="settingsMeta">
            <a href={closeHref}>{copy.settings.cancel}</a>
            <span>{llmSettings.updatedAt ? `${copy.common.updated} ${formatDate(llmSettings.updatedAt, locale, copy.common.noDate)}` : copy.settings.updatedDefault}</span>
            <button type="submit">{copy.settings.save}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReaderSummaryCard({
  copy,
  itemId,
  locale,
  returnTo,
  summary
}: {
  copy: UiCopy;
  itemId: string;
  locale: SystemLanguage;
  returnTo: string;
  summary: ArticleSummary;
}) {
  const sourceLabel =
    summary.source === "placeholder"
      ? copy.item.summaryPending
      : summary.source === "pending"
        ? copy.item.summaryGeneratingMeta
        : summary.source === "failed"
          ? copy.item.summaryFailedMeta
          : null;
  const statusClass =
    summary.source === "placeholder" || summary.source === "pending"
      ? "isPending"
      : summary.source === "failed"
        ? "isError"
        : "";
  const summaryCardId = `reader-summary-${itemId}`;

  return (
    <section className={`readerSummaryCard ${statusClass}`} id={summaryCardId} aria-label={copy.item.summary}>
      <SummaryScrollRestorer itemId={itemId} pending={summary.source === "pending"} ready={summary.source === "llm"} targetId={summaryCardId} />
      <header>
        <div className="readerSummaryMeta">
          <span className="summaryMark"><span /></span>
          <strong>{copy.item.summary}</strong>
          {sourceLabel ? (
            <>
              <span>·</span>
              <em>{sourceLabel}</em>
            </>
          ) : null}
        </div>
        {summary.source !== "placeholder" && summary.source !== "pending" ? (
          <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
        ) : null}
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
  copy,
  item,
  items,
  locale,
  refetched,
  summaryStatus
}: {
  backContext: ReaderEntryContext;
  copy: UiCopy;
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
  locale: SystemLanguage;
  refetched?: string;
  summaryStatus?: string;
}) {
  if (!item) return null;

  const preparedArticle = sanitizeArticleHtmlWithToc(item.document?.articleHtml, item.document?.text, item.id);
  const readerHtml = preparedArticle.html;
  const tocItems = preparedArticle.tocItems;
  const summary = readerSummary(item.document, copy);
  const extractionNote = getExtractionNote(item.document?.metadataJson);
  const hasFetchError = isArticleFetchError(item);
  const isFetching = isArticleFetching(item);
  const error = hasFetchError ? fetchErrorCopy(item, copy) : null;
  const source = hostnameFor(item);
  const originalUrl = item.contentObject?.normalizedUrl ?? item.url;
  const related = items.filter((other) => other.id !== item.id && other.savedToLibrary).slice(0, 3);
  const readerBodyId = `reader-body-${item.id}`;
  const returnTo = buildHref({ ...backContext.query, item: item.id });
  const deleteReturnTo = buildHref(backContext.query);
  const readerShowSave = itemShowsSaveAction(item, backContext);
  const readerShowArchive = itemShowsArchiveAction(item, backContext);
  const annotations = item.annotations.map((annotation) => ({
    id: annotation.id,
    quote: annotation.quote,
    note: annotation.note,
    locationJson: annotation.locationJson,
    createdAt: annotation.createdAt.toISOString()
  }));

  return (
    <article className="readerView">
      <Link href={appRoute(backContext.query)} className="readerBackButton" title={localeAria(copy, `Back to ${backContext.label}`, `返回${backContext.label}`)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="m14 6-6 6 6 6" />
        </svg>
        {backContext.label}
      </Link>
      <div className="readerToolbar">
        <div>
          <ReaderHighlighter annotations={annotations} itemId={item.id} itemTitle={item.title} targetId={readerBodyId} />
          {item.type === "article" && item.url ? (
            <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} locale={locale} returnTo={returnTo} />
          ) : null}
          {readerShowArchive ? (
            <form action={item.archivedAt ? unarchiveItemAction : archiveItemAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <button className="readerIconButton" type="submit" title={item.archivedAt ? (locale === "zh-Hans" ? "恢复到资料库" : "Restore to library") : (locale === "zh-Hans" ? "移至归档" : "Move to archive")} aria-label={item.archivedAt ? (locale === "zh-Hans" ? "恢复到资料库" : "Restore to library") : (locale === "zh-Hans" ? "移至归档" : "Move to archive")}>
                {item.archivedAt ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
              </button>
            </form>
          ) : null}
          <DeleteItemButton className="readerIconButton isDanger" itemId={item.id} itemTitle={item.title} locale={locale} returnTo={deleteReturnTo}>
            <TrashIcon size={15} />
          </DeleteItemButton>
          {readerShowSave ? (
            <form action={toggleItemSavedAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="savedToLibrary" value="true" />
              <button className="saveToggleButton" type="submit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M6 4h12v17l-6-4-6 4Z" />
                </svg>
                {copy.common.saveToLibrary}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="readerMeta">
        <span className="tag">{itemKindLabel(item, copy)}</span>
        {originalUrl ? (
          <a className="readerSourceLink" href={originalUrl} target="_blank" rel="noreferrer">
            {source}
          </a>
        ) : (
          <strong>{source}</strong>
        )}
        <span>·</span>
        <span>{formatDate(item.publishedAt ?? item.createdAt, locale, copy.common.noDate)}</span>
      </div>

      <h1>{item.title}</h1>

      <div className="readerSubhead">
        <span>{copy.item.by} <strong>{item.author ?? source}</strong></span>
        <div className="readerSubheadActions">
          {!hasFetchError && !isFetching ? (
            <ReaderProgress
              archiveAction={archiveItemAction}
              archived={Boolean(item.archivedAt)}
              canArchive={Boolean(readerShowArchive)}
              initialProgress={item.readingProgress}
              initialPositionJson={item.readingPositionJson}
              itemId={item.id}
              locale={locale}
              readTime={estimateRead(item.document?.text, locale)}
              returnTo={deleteReturnTo}
              skipInitialRestoreKey={summary.source === "llm" ? `curioflow-summary-pending:${item.id}` : undefined}
              targetId={readerBodyId}
            />
          ) : (
            <span className="readerSubheadMeta">{estimateRead(item.document?.text, locale)} · {statusLabel(item.status, copy)}</span>
          )}
        </div>
      </div>

      {hasFetchError && error ? (
        <section className="readerFetchCard readerFetchCard--error" aria-label={copy.item.readerFetchAria}>
          <div className="readerFetchIcon">
            <WarningTriangleIcon size={24} />
          </div>
          <h2>{error.title}</h2>
          <p>{error.message}</p>
          <div className="readerFetchActions">
            <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} locale={locale} returnTo={returnTo} variant="readerRetry" />
            {originalUrl ? (
              <a className="readerFetchOrigin" href={originalUrl} target="_blank" rel="noreferrer">
                {copy.common.openOriginal}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {isFetching ? (
        <section className="readerFetchCard readerFetchCard--fetching" aria-label={copy.item.readerFetchingAria}>
          <div className="readerFetchSpinner">
            <span className="pulseDot" />
            <span>{copy.item.fetchingReader}</span>
          </div>
          <p>{copy.item.readerFetchingHelp}</p>
        </section>
      ) : null}

      {!hasFetchError && !isFetching ? (
        <>
          <ReaderSummaryCard copy={copy} itemId={item.id} locale={locale} returnTo={returnTo} summary={summary} />

          {extractionNote ? (
            <div className="extractionNote">
              {extractionNote}
            </div>
          ) : null}
          {refetched === "article" ? (
            <div className="refetchNotice">{copy.item.refetched}</div>
          ) : null}
          {summaryStatus === "regenerated" ? (
            <div className="refetchNotice">{copy.item.summaryRegenerated}</div>
          ) : null}
          {summaryStatus === "missing-llm" ? (
            <div className="refetchNotice isError">{copy.item.summaryMissingLlm}</div>
          ) : null}
          {summaryStatus === "error" ? (
            <div className="refetchNotice isError">{copy.item.summaryError}</div>
          ) : null}
          {tocItems.length > 0 ? <ReaderToc items={tocItems} locale={locale} targetId={readerBodyId} /> : null}

          <div className="readerBody readerArticle" id={readerBodyId}>
            {readerHtml ? (
              <div dangerouslySetInnerHTML={{ __html: readerHtml }} />
            ) : (
              <PlainTextArticle text={item.document?.text ?? copy.item.fullTextPending} />
            )}
          </div>

          {originalUrl ? (
            <a className="originButton" href={originalUrl} target="_blank" rel="noreferrer">
              {copy.common.openOriginal}
            </a>
          ) : null}
        </>
      ) : null}

      <section className="relatedBlock">
        <h2>{copy.item.relatedTitle}</h2>
        {related.length === 0 ? (
          <p>{copy.item.relatedEmpty}</p>
        ) : (
          related.map((relatedItem) => (
            <Link href={readerItemRoute(relatedItem.id, backContext)} key={relatedItem.id}>
              <span>{hostnameFor(relatedItem)}</span>
              <strong>{relatedItem.title}</strong>
              <em>{estimateRead(relatedItem.document?.text, locale)}</em>
            </Link>
          ))
        )}
      </section>
    </article>
  );
}

export async function CurioflowHome({ searchParams, routeParams = {} }: CurioflowHomeProps) {
  const queryParams = (await searchParams) ?? {};
  const params = { ...routeParams, ...queryParams };
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
  const currentPage = pageFilter(params?.page);
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    sourceType: recentPostsFilter ? "rss" : undefined,
    status: itemStatusFilter(params?.status),
    archived: archivedFilter,
    recentPosts: recentPostsFilter,
    page: currentPage
  };
  const [user, library, inboxPage, readerItem, counts, sources, brief, thread, llmSettings, digestItems] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(filter, { page: currentPage, pageSize: 20 }),
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

  const items = inboxPage.items;
  const locale = normalizeSystemLanguage(llmSettings.systemLanguage);
  const copy = getUiCopy(locale);
  const backContext = readerEntryContext(params, filter, sources, copy);
  const hasActiveJobs = counts.jobs.some((job) => job.status === "queued" || job.status === "running");
  const hasPendingReaderSummary = isSummaryGenerationPending(readerItem?.document?.metadataJson);
  const baseQuery = {
    item: params?.item,
    q: params?.q,
    filter: libraryFilterParam,
    refetched: params?.refetched,
    source: params?.source,
    sourceKind: params?.sourceKind,
    status: params?.status,
    summary: params?.summary,
    thread: params?.thread,
    view: params?.view && params.view !== "settings" && params.view !== "archive" ? params.view : undefined
  };
  const settingsCloseHref = buildHref(baseQuery);
  const settingsHref = buildHref({ ...baseQuery, settings: "1" }) as Route;
  const settingsOpen = params?.settings === "1" || params?.view === "settings";

  return (
    <main className="appShell">
      <JobStatusRefresh active={hasActiveJobs || hasPendingReaderSummary} />
      <Sidebar copy={copy} locale={locale} sources={sources} activeItemId={readerItem?.id} filter={filter} settingsHref={settingsHref} view={view} userName={user.displayName} />

      <section className="mainShell" aria-label={library.name}>
        <div className="scrollArea">
          {readerItem ? (
            <ReaderView backContext={backContext} copy={copy} item={readerItem} items={items} locale={locale} refetched={params?.refetched} summaryStatus={params?.summary} />
          ) : view === "brief" ? (
            <BriefingView brief={brief} copy={copy} counts={counts} digestItems={digestItems} thread={thread} />
          ) : view === "ask" ? (
            <AskView copy={copy} thread={thread} />
          ) : (
            <LibraryView
              copy={copy}
              items={items}
              locale={locale}
              sources={sources}
              filter={filter}
              pagination={inboxPage}
              opmlImported={params?.opmlImported}
              opmlFailed={params?.opmlFailed}
            />
          )}
        </div>
      </section>
      <AddSourceDialog
        addPodcastAction={addPodcastSourceAction}
        importOpmlAction={importOpmlSourcesAction}
        initialOpen={Boolean(params?.add || params?.rssPreview)}
        initialTab={activeAddTab}
        locale={locale}
        opmlError={opmlError}
        podcastError={podcastError}
        podcastUrl={podcastUrl}
        rssPreviewError={rssPreviewError}
        rssPreviewUrl={rssPreviewUrl}
        saveUrlAction={saveUrlAction}
        subscribeRssAction={addRssSourceAction}
        uploadPdfAction={uploadPdfAction}
      />
      <SettingsDialog
        closeHref={settingsCloseHref}
        copy={copy}
        isOpen={settingsOpen}
        locale={locale}
        llmSettings={llmSettings}
        returnTo={settingsCloseHref}
        saved={params?.saved}
      />
    </main>
  );
}
