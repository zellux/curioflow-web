import Link from "next/link";
import {
  addRssSourceAction,
  askLibraryAction,
  createAnnotationAction,
  saveUrlAction,
  toggleItemSavedAction,
  unsubscribeSourceAction,
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
import { ReaderHighlighter } from "@/app/reader-highlighter";
import { ReaderProgress } from "@/app/reader-progress";

type PageSearchParams = {
  add?: string;
  item?: string;
  q?: string;
  rssError?: string;
  read?: string;
  rssPreview?: string;
  source?: string;
  status?: string;
  style?: string;
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
  readStatus?: string;
  status?: string;
};
type AppView = "library" | "digest" | "brief" | "ask" | "settings";
type AddSourceTab = "rss" | "url" | "pdf";
type ReaderStyle = "broadsheet" | "journal" | "quiet";
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

function readerStyle(value?: string): ReaderStyle {
  return value === "journal" || value === "quiet" ? value : "broadsheet";
}

function addSourceTab(value?: string, hasRssPreview = false): AddSourceTab {
  if (hasRssPreview) return "rss";
  return value === "url" || value === "pdf" ? value : "rss";
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
  return !filter.query && !filter.sourceId && !filter.readStatus && !filter.status;
}

function libraryEntryContext(
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>
): ReaderEntryContext {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const label = filter.query
    ? "Search results"
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

  if (params?.view === "digest") {
    return { label: "Digest", query: { view: "digest" } };
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

function DigestIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 5h14M5 11h14M5 17h9" />
      <path d="M4 3h16v18H4z" />
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
  view,
  userName
}: {
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  activeItemId?: string;
  filter: LibraryFilter;
  view: AppView;
  userName: string;
}) {
  const rssSources = sources.filter((source) => source.type === "rss");
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const pdfCount = sources.find((source) => source.id === "manual-pdf-source")?._count.items ?? 0;
  const activeClass = !activeItemId && view === "library" && isUnfiltered(filter) ? "active" : "";

  return (
    <aside className="sidebar" aria-label="Library navigation">
      <Link className="brand" href="/">
        <span className="brandMark"><span /></span>
        <strong>Curioflow</strong>
      </Link>

      <Link className="addSourceButton" href="/?add=rss"><span aria-hidden="true">+</span> Add source</Link>

      <nav className="navList">
        <Link className={activeClass} href="/">
          <span className="navIcon"><LibraryIcon /></span>
          Library
        </Link>
        <Link className={view === "brief" ? "active" : ""} href="/?view=brief">
          <span className="navIcon"><BriefIcon /></span>
          Daily Briefing
        </Link>
        <Link className={view === "digest" ? "active" : ""} href="/?view=digest">
          <span className="navIcon"><DigestIcon /></span>
          Digest
        </Link>
        <Link className={view === "ask" ? "active" : ""} href="/?view=ask">
          <span className="navIcon"><AskIcon /></span>
          Ask your library
        </Link>
        <Link className={view === "settings" ? "active" : ""} href="/?view=settings">
          <span className="navIcon"><SettingsIcon /></span>
          Settings
        </Link>
      </nav>

      <section className="sideGroup">
        <h2>Feeds</h2>
        {rssSources.slice(0, 8).map((source) => (
          <div className={`feedSideRow ${filter.sourceId === source.id ? "active" : ""}`} key={source.id}>
            <Link className="feedSideLink" href={`/?source=${source.id}`}>
              <span>{source.name}</span>
              <strong>{source._count.items}</strong>
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
        <h2>Library</h2>
        <Link className={`sideRow ${filter.sourceId === "manual-url-source" ? "active" : ""}`} href="/?source=manual-url-source">
          <span>Saved URLs</span>
          <strong>{savedUrlCount}</strong>
        </Link>
        <Link className={`sideRow ${filter.sourceId === "manual-pdf-source" ? "active" : ""}`} href="/?source=manual-pdf-source">
          <span>PDF Uploads</span>
          <strong>{pdfCount}</strong>
        </Link>
        <Link className={`sideRow ${filter.readStatus === "unread" ? "active" : ""}`} href="/?read=unread">
          <span>Unread</span>
          <strong>{counts.unread}</strong>
        </Link>
      </section>

      <div className="workspaceCard">
        <span>{userName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>Personal workspace</strong>
          <small>Local · default library</small>
        </div>
      </div>
    </aside>
  );
}

function AddSourceDialog({
  activeTab,
  isOpen,
  rssPreviewError,
  rssPreviewUrl,
  style
}: {
  activeTab: AddSourceTab;
  isOpen: boolean;
  rssPreviewError: string | null;
  rssPreviewUrl?: string;
  style: ReaderStyle;
}) {
  const styleParam = style === "broadsheet" ? undefined : style;
  const closeHref = buildHref({ style: styleParam });
  const tabHref = (tab: AddSourceTab) => buildHref({ add: tab, style: styleParam });

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
          <a className={activeTab === "url" ? "active" : ""} href={tabHref("url")}><UrlIcon size={14} /> URL</a>
          <a className={activeTab === "pdf" ? "active" : ""} href={tabHref("pdf")}><PdfIcon size={14} /> PDF</a>
        </div>

        <div className="sourcePanels">
          {activeTab === "rss" ? (
            <RssSubscribeForm
              initialError={rssPreviewError}
              initialUrl={rssPreviewUrl}
              style={styleParam}
              subscribeAction={addRssSourceAction}
            />
          ) : null}

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

function Topbar({
  isReader,
  style,
  styleLinks,
  view
}: {
  isReader: boolean;
  style: ReaderStyle;
  styleLinks: Record<ReaderStyle, string>;
  view: AppView;
}) {
  const label = isReader
    ? "Library / Reading"
    : view === "brief"
      ? "Daily Briefing"
      : view === "digest"
        ? "Digest"
      : view === "ask"
        ? "Ask your library"
        : view === "settings"
          ? "Settings"
          : "Library";

  return (
    <header className="topbar">
      <span>{label}</span>
      <div className="styleSwitcher" aria-label="Reader style">
        <small>Style</small>
        <div>
          <a className={style === "broadsheet" ? "active" : ""} href={styleLinks.broadsheet}>Broadsheet</a>
          <a className={style === "journal" ? "active" : ""} href={styleLinks.journal}>Journal</a>
          <a className={style === "quiet" ? "active" : ""} href={styleLinks.quiet}>Quiet</a>
        </div>
      </div>
    </header>
  );
}

function LibraryView({
  items,
  sources,
  counts,
  filter,
  thread
}: {
  items: InboxItem[];
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  filter: LibraryFilter;
  thread: ChatThread;
}) {
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const rssSourceCount = sources.filter((source) => source.type === "rss").length;
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const isFeedPage = activeSource?.type === "rss";
  const entryContext = libraryEntryContext(filter, sources);
  const heading = filter.query
    ? `Search: ${filter.query}`
    : filter.readStatus === "unread"
      ? "Unread"
      : filter.status === "ready"
        ? "Indexed"
        : activeSource?.name ?? "Library";

  return (
    <div className="libraryView">
      <div className="libraryHeading">
        <div>
          <h1>{heading}</h1>
          <p>{counts.ready} indexed · {counts.unread} unread · {counts.jobs.length} recent jobs</p>
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

      <form action="/" className="searchShell">
        {filter.sourceId ? <input type="hidden" name="source" value={filter.sourceId} /> : null}
        {filter.readStatus ? <input type="hidden" name="read" value={filter.readStatus} /> : null}
        {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}
        <span>⌕</span>
        <input name="q" placeholder="Search your library..." defaultValue={filter.query ?? ""} />
      </form>

      <div className="chips">
        <Link className={isUnfiltered(filter) ? "active" : ""} href="/">All</Link>
        <Link className={filter.readStatus === "unread" ? "active" : ""} href="/?read=unread">Unread</Link>
        <Link className={filter.status === "ready" ? "active" : ""} href="/?status=ready">Indexed</Link>
        <Link className={filter.sourceId === "manual-url-source" ? "active" : ""} href="/?source=manual-url-source">
          {savedUrlCount} Saved URLs
        </Link>
        {filter.query ? <Link href="/">Clear search</Link> : null}
        <span>{rssSourceCount} RSS feeds</span>
      </div>

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>Save the first article to begin.</h2>
          </div>
        ) : (
          items.map((item) => (
            <Link className="feedItem" href={readerItemRoute(item.id, entryContext)} key={item.id}>
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
                <span className="readTime">{estimateRead(item.document?.text)}</span>
              </div>
              <h2>{item.title}</h2>
              <p>{summarize(item.document?.text)}</p>
            </Link>
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
  thread
}: {
  brief: Brief;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
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

function DigestView({ items }: { items: DigestItem[] }) {
  const entryContext: ReaderEntryContext = { label: "Digest", query: { view: "digest" } };

  return (
    <article className="digestView">
      <header>
        <span>{items.length} recent reads</span>
        <h1>Digest</h1>
        <p>Recent saved articles, opened as short introductions before you decide what deserves a full read.</p>
      </header>

      <div className="digestList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>Save articles to build a digest.</h2>
          </div>
        ) : (
          items.map((item) => (
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

function annotationKindLabel(locationJson: string) {
  try {
    const location = JSON.parse(locationJson) as { type?: unknown };
    return location.type === "highlight" ? "Highlight" : "Note";
  } catch {
    return "Note";
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

function SettingsView({
  llmSettings,
  saved
}: {
  llmSettings: LlmSettings;
  saved?: string;
}) {
  return (
    <article className="settingsView">
      <header>
        <h1>Settings</h1>
        <p>Configure the local defaults Curioflow will use for transcripts, summaries, and library analysis.</p>
      </header>

      <section className="settingsPanel">
        <div className="sectionHeading">
          <h2>LLM API</h2>
          <span>{llmSettings.hasApiKey ? "Key saved" : "No key saved"}</span>
        </div>
        {saved === "llm" ? <p className="settingsSaved">LLM settings saved.</p> : null}
        <form action={updateLlmSettingsAction} className="settingsForm">
          <label>
            <span>Provider</span>
            <select name="provider" defaultValue={llmSettings.provider}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic-compatible</option>
              <option value="local">Local endpoint</option>
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input name="baseUrl" type="url" defaultValue={llmSettings.baseUrl} placeholder="https://api.openai.com/v1" />
          </label>
          <label>
            <span>Model</span>
            <input name="model" defaultValue={llmSettings.model} placeholder="gpt-4.1-mini" />
          </label>
          <label>
            <span>API key</span>
            <input name="apiKey" type="password" placeholder={llmSettings.hasApiKey ? "Saved key hidden · enter a new key to replace it" : "sk-..."} />
          </label>
          <div className="settingsMeta">
            <span>{llmSettings.updatedAt ? `Updated ${formatDate(llmSettings.updatedAt)}` : "Using defaults until saved"}</span>
            <button type="submit">Save LLM settings</button>
          </div>
        </form>
      </section>
    </article>
  );
}

function ReaderView({
  backContext,
  item,
  items,
  thread
}: {
  backContext: ReaderEntryContext;
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
  thread: ChatThread;
}) {
  if (!item) return null;

  const readerHtml = sanitizeArticleHtml(item.document?.articleHtml);
  const extractionNote = getExtractionNote(item.document?.metadataJson);
  const source = hostnameFor(item);
  const related = items.filter((other) => other.id !== item.id && other.savedToLibrary).slice(0, 3);
  const readerBodyId = `reader-body-${item.id}`;

  return (
    <article className="readerView">
      <div className="readerToolbar">
        <Link href={appRoute(backContext.query)} className="backLink">‹ {backContext.label}</Link>
        <div>
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
          <a className="accentButton" href="#ask">Ask about this</a>
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

      {extractionNote ? (
        <div className={`extractionNote ${item.document?.parserVersion === "mock-url-v1" ? "warning" : ""}`}>
          {extractionNote}
        </div>
      ) : null}

      <div className="readerBody readerArticle" id={readerBodyId}>
        {readerHtml ? (
          <div dangerouslySetInnerHTML={{ __html: readerHtml }} />
        ) : (
          <PlainTextArticle text={item.document?.text ?? "This item is still waiting for a document."} />
        )}
      </div>
      <ReaderHighlighter itemId={item.id} targetId={readerBodyId} />

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

      <section className="annotationPanel" id="notes">
        <div className="sectionHeading">
          <h2>Notes and highlights</h2>
          <span>{item.annotations.length} saved</span>
        </div>
        <form action={createAnnotationAction} className="annotationForm">
          <input type="hidden" name="itemId" value={item.id} />
          <textarea name="quote" placeholder="Paste a sentence or passage to keep..." required />
          <input name="note" placeholder="Add a note, optional" />
          <button type="submit">Save note</button>
        </form>
        {item.annotations.length > 0 ? (
          <div className="annotationList">
            {item.annotations.map((annotation) => (
              <div className="annotationItem" key={annotation.id}>
                <span>{annotationKindLabel(annotation.locationJson)}</span>
                <blockquote>{annotation.quote}</blockquote>
                {annotation.note ? <p>{annotation.note}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="annotationEmpty">No notes saved for this item yet.</p>
        )}
      </section>

      <section className="askStrip readerAsk" id="ask">
        <div className="sectionHeading">
          <h2>Ask about this</h2>
          <span>Local placeholder</span>
        </div>
        <p>Searches only this item&apos;s indexed chunks while the real answer engine is pending.</p>
        <form action={askLibraryAction} className="askForm">
          <input type="hidden" name="itemId" value={item.id} />
          <input name="question" placeholder="Ask about this document..." required />
          <button type="submit">Ask</button>
        </form>
        <AssistantAnswer entryContext={backContext} thread={thread} />
      </section>

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
    params?.view === "brief"
      ? "brief"
      : params?.view === "digest"
        ? "digest"
        : params?.view === "ask"
          ? "ask"
          : params?.view === "settings"
            ? "settings"
            : "library";
  const style = readerStyle(params?.style);
  const activeAddTab = addSourceTab(params?.add, Boolean(params?.rssPreview));
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    readStatus: readStatusFilter(params?.read),
    status: itemStatusFilter(params?.status)
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
  const unsubscribeSource = params?.unsubscribe
    ? sources.find((source) => source.id === params.unsubscribe && source.type === "rss") ?? null
    : null;
  const unsubscribeCancelHref = buildHref({
    q: params?.q,
    read: params?.read,
    source: params?.source,
    status: params?.status,
    style: params?.style,
    view: params?.view
  });

  const isReader = Boolean(readerItem);
  const styleLinkParams = {
    item: params?.item,
    q: params?.q,
    read: params?.read,
    source: params?.source,
    status: params?.status,
    thread: params?.thread,
    view: params?.view
  };
  const styleLinks = {
    broadsheet: buildHref({ ...styleLinkParams, style: "broadsheet" }),
    journal: buildHref({ ...styleLinkParams, style: "journal" }),
    quiet: buildHref({ ...styleLinkParams, style: "quiet" })
  };
  const backContext = readerEntryContext(params, filter, sources);

  return (
    <main className={`appShell theme-${style}`}>
      <Sidebar counts={counts} sources={sources} activeItemId={readerItem?.id} filter={filter} view={view} userName={user.displayName} />

      <section className="mainShell" aria-label={library.name}>
        <Topbar isReader={isReader} style={style} styleLinks={styleLinks} view={view} />
        <div className="scrollArea">
          {readerItem ? (
            <ReaderView backContext={backContext} item={readerItem} items={items} thread={thread} />
          ) : view === "brief" ? (
            <BriefingView brief={brief} counts={counts} thread={thread} />
          ) : view === "digest" ? (
            <DigestView items={digestItems} />
          ) : view === "ask" ? (
            <AskView thread={thread} />
          ) : view === "settings" ? (
            <SettingsView llmSettings={llmSettings} saved={params?.saved} />
          ) : (
            <LibraryView items={items} sources={sources} counts={counts} filter={filter} thread={thread} />
          )}
        </div>
      </section>
      <AddSourceDialog
        activeTab={activeAddTab}
        isOpen={Boolean(params?.add || params?.rssPreview)}
        rssPreviewError={rssPreviewError}
        rssPreviewUrl={rssPreviewUrl}
        style={style}
      />
      <UnsubscribeDialog cancelHref={unsubscribeCancelHref} source={unsubscribeSource} />
    </main>
  );
}
