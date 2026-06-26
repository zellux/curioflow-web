import Link from "next/link";
import {
  addRssSourceAction,
  askLibraryAction,
  createAnnotationAction,
  previewRssSourceAction,
  saveUrlAction,
  updateReadStatusAction,
  uploadPdfAction
} from "@/app/actions";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtml } from "@/server/reader/rendering";
import { getLibrarySources } from "@/server/sources";
import { getOrCreateTodayBrief } from "@/server/briefs";
import { getChatThread } from "@/server/chat";
import { previewRssSourceForCurrentLibrary } from "@/server/ingest/rss";

type HomeProps = {
  searchParams?: Promise<{
    item?: string;
    q?: string;
    read?: string;
    rssPreview?: string;
    source?: string;
    status?: string;
    thread?: string;
    view?: string;
  }>;
};

type InboxItem = Awaited<ReturnType<typeof getInboxItems>>[number];
type Brief = Awaited<ReturnType<typeof getOrCreateTodayBrief>>;
type ChatThread = Awaited<ReturnType<typeof getChatThread>>;
type LibraryFilter = {
  query?: string;
  sourceId?: string;
  readStatus?: string;
  status?: string;
};
type AppView = "library" | "brief" | "ask";
type RssPreview = Awaited<ReturnType<typeof previewRssSourceForCurrentLibrary>>;
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

function isUnfiltered(filter: LibraryFilter) {
  return !filter.query && !filter.sourceId && !filter.readStatus && !filter.status;
}

function AssistantAnswer({ thread }: { thread: ChatThread }) {
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
            <Link href={`/?item=${citation.itemId}`} key={`${citation.itemId}-${citation.title}`}>
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

      <Link className="addSourceButton" href="#add-source">+ Add source</Link>

      <nav className="navList">
        <Link className={activeClass} href="/">
          <span className="navIcon">☰</span>
          Library
        </Link>
        <Link className={view === "brief" ? "active" : ""} href="/?view=brief">
          <span className="navIcon">☼</span>
          Daily Briefing
        </Link>
        <Link className={view === "ask" ? "active" : ""} href="/?view=ask">
          <span className="navIcon">⌕</span>
          Ask your library
        </Link>
      </nav>

      <section className="sideGroup">
        <h2>Feeds</h2>
        {rssSources.slice(0, 8).map((source) => (
          <Link className={`sideRow ${filter.sourceId === source.id ? "active" : ""}`} href={`/?source=${source.id}`} key={source.id}>
            <span>{source.name}</span>
            <strong>{source._count.items}</strong>
          </Link>
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
  rssPreview,
  rssPreviewError,
  rssPreviewUrl
}: {
  rssPreview: RssPreview | null;
  rssPreviewError: string | null;
  rssPreviewUrl?: string;
}) {
  return (
    <div className="addDialog" id="add-source" role="dialog" aria-labelledby="add-source-title">
      <Link className="addDialogBackdrop" href="/" aria-label="Close add source dialog" />
      <section className="addDialogPanel">
        <header>
          <h2 id="add-source-title">Add a source</h2>
          <Link href="/" aria-label="Close add source dialog">×</Link>
        </header>
        <p>Everything you add is fetched, parsed into clean reading text, and indexed into your library.</p>

        <div className="sourceTabs" aria-label="Source types">
          <span className="active">RSS</span>
          <span>URL</span>
          <span>PDF</span>
        </div>

        <div className="sourcePanels">
          <form action={previewRssSourceAction} className="sourceForm">
            <label htmlFor="rss-url">Feed or site URL</label>
            <input id="rss-url" name="url" type="url" placeholder="https://example.com/feed.xml" defaultValue={rssPreviewUrl ?? ""} required />
            <button type="submit">Preview RSS feed</button>
          </form>
          {rssPreview ? (
            <div className="rssPreviewCard">
              <div className="sourcePreview">
                <span className="previewIcon">◔</span>
                <div>
                  <strong>{rssPreview.title}</strong>
                  <small>
                    Feed detected · {rssPreview.totalEntries} recent article{rssPreview.totalEntries === 1 ? "" : "s"}
                  </small>
                </div>
                <span className="validBadge">Valid</span>
              </div>
              {rssPreview.siteUrl ? <a href={rssPreview.siteUrl} target="_blank" rel="noreferrer">{rssPreview.siteUrl}</a> : null}
              <div className="rssPreviewEntries">
                {rssPreview.entries.map((entry) => (
                  <div key={entry.url}>
                    <strong>{entry.title ?? entry.url}</strong>
                    <span>{entry.publishedAt ? formatDate(entry.publishedAt) : new URL(entry.url).hostname}</span>
                  </div>
                ))}
              </div>
              <form action={addRssSourceAction} className="sourceForm">
                <input type="hidden" name="url" value={rssPreview.normalizedFeedUrl} />
                <button type="submit">
                  {rssPreview.existingSource ? "Open existing feed" : "Add feed and import articles"}
                </button>
              </form>
            </div>
          ) : null}
          {rssPreviewError ? <div className="sourceError">{rssPreviewError}</div> : null}

          <form action={saveUrlAction} className="sourceForm">
            <label htmlFor="page-url">Page URL</label>
            <input id="page-url" name="url" type="url" placeholder="Paste a link to any article..." required />
            <div className="sourcePreview">
              <span className="previewIcon">↗</span>
              <div>
                <strong>Reader view ready</strong>
                <small>Curioflow strips navigation, saves clean text, and indexes it.</small>
              </div>
            </div>
            <button type="submit">Save URL</button>
          </form>

          <form action={uploadPdfAction} className="sourceForm">
            <label htmlFor="pdf-file">PDF</label>
            <div className="pdfDrop">
              <span>PDF</span>
              <strong>Choose a PDF to upload</strong>
              <small>Up to 50 MB · parsed into reading text</small>
              <input id="pdf-file" name="file" type="file" accept="application/pdf" required />
            </div>
            <button type="submit">Upload PDF</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function Topbar({ isReader, view }: { isReader: boolean; view: AppView }) {
  const label = isReader ? "Library / Reading" : view === "brief" ? "Daily Briefing" : view === "ask" ? "Ask your library" : "Library";

  return (
    <header className="topbar">
      <span>{label}</span>
      <div className="styleSwitcher" aria-label="Reader style">
        <small>Style</small>
        <div>
          <button className="active" type="button">Broadsheet</button>
          <button type="button">Journal</button>
          <button type="button">Quiet</button>
        </div>
      </div>
    </header>
  );
}

function LibraryView({
  items,
  sources,
  counts,
  brief,
  filter,
  thread
}: {
  items: InboxItem[];
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  brief: Brief;
  filter: LibraryFilter;
  thread: ChatThread;
}) {
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const rssSourceCount = sources.filter((source) => source.type === "rss").length;
  const briefSections = parseBriefSections(brief);
  const activeSource = sources.find((source) => source.id === filter.sourceId);
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
        <span>{items.length} shown</span>
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

      <section className="briefPreview" id="brief">
        <div>
          <small>Daily Briefing</small>
          <h2>Good morning. Here is what you have been thinking about.</h2>
          <p>{brief.summary}</p>
          {briefSections.slice(0, 2).map((section) => (
            <div className="briefSection" key={section.title}>
              <strong>{section.title}</strong>
              <span>{section.summary}</span>
            </div>
          ))}
          <Link className="briefLink" href="/?view=brief">Open briefing</Link>
        </div>
        <span>{counts.unread} new</span>
      </section>

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>Save the first article to begin.</h2>
          </div>
        ) : (
          items.map((item) => (
            <Link className="feedItem" href={`/?item=${item.id}`} key={item.id}>
              <div className="itemByline">
                <span className="tag">{item.type === "pdf" ? "PDF" : "URL"}</span>
                <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
                <span>·</span>
                <span>{formatDate(item.createdAt)}</span>
                <span className="readTime">{estimateRead(item.document?.text)}</span>
              </div>
              <h2>{item.title}</h2>
              <p>{summarize(item.document?.text)}</p>
              {item.readStatus === "unread" ? <span className="unreadDot" /> : null}
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
        <AssistantAnswer thread={thread} />
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
                  <Link href={`/?item=${citation.itemId}`} key={`${section.title}-${citation.itemId}`}>
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
        <AssistantAnswer thread={thread} />
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
                        <Link href={`/?item=${citation.itemId}`} key={`${message.id}-${citation.itemId}`}>
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

function ReaderView({
  item,
  items,
  thread
}: {
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
  thread: ChatThread;
}) {
  if (!item) return null;

  const readerHtml = sanitizeArticleHtml(item.document?.articleHtml);
  const extractionNote = getExtractionNote(item.document?.metadataJson);
  const source = hostnameFor(item);
  const related = items.filter((other) => other.id !== item.id).slice(0, 3);

  return (
    <article className="readerView">
      <div className="readerToolbar">
        <Link href="/" className="backLink">‹ Library</Link>
        <div>
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
        <span className="tag">{item.type === "pdf" ? "PDF" : "URL"}</span>
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

      <div className="readerBody readerArticle">
        {readerHtml ? (
          <div dangerouslySetInnerHTML={{ __html: readerHtml }} />
        ) : (
          <PlainTextArticle text={item.document?.text ?? "This item is still waiting for a document."} />
        )}
      </div>

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
        <AssistantAnswer thread={thread} />
      </section>

      <section className="relatedBlock">
        <h2>Related in your library</h2>
        {related.length === 0 ? (
          <p>No related saves yet.</p>
        ) : (
          related.map((relatedItem) => (
            <Link href={`/?item=${relatedItem.id}`} key={relatedItem.id}>
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
  const view: AppView = params?.view === "brief" ? "brief" : params?.view === "ask" ? "ask" : "library";
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    readStatus: readStatusFilter(params?.read),
    status: itemStatusFilter(params?.status)
  };
  const [user, library, items, readerItem, counts, sources, brief, thread] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(filter),
    getItemForReader(params?.item),
    getDashboardCounts(),
    getLibrarySources(),
    getOrCreateTodayBrief(),
    getChatThread(params?.thread)
  ]);
  let rssPreview: RssPreview | null = null;
  let rssPreviewError: string | null = null;
  const rssPreviewUrl = searchFilter(params?.rssPreview);

  if (rssPreviewUrl) {
    try {
      rssPreview = await previewRssSourceForCurrentLibrary(rssPreviewUrl);
    } catch (error) {
      rssPreviewError = error instanceof Error ? error.message : "Unable to preview RSS source";
    }
  }

  const isReader = Boolean(readerItem);

  return (
    <main className="appShell">
      <Sidebar counts={counts} sources={sources} activeItemId={readerItem?.id} filter={filter} view={view} userName={user.displayName} />

      <section className="mainShell" aria-label={library.name}>
        <Topbar isReader={isReader} view={view} />
        <div className="scrollArea">
          {readerItem ? (
            <ReaderView item={readerItem} items={items} thread={thread} />
          ) : view === "brief" ? (
            <BriefingView brief={brief} counts={counts} thread={thread} />
          ) : view === "ask" ? (
            <AskView thread={thread} />
          ) : (
            <LibraryView items={items} sources={sources} counts={counts} brief={brief} filter={filter} thread={thread} />
          )}
        </div>
      </section>
      <AddSourceDialog rssPreview={rssPreview} rssPreviewError={rssPreviewError} rssPreviewUrl={rssPreviewUrl} />
    </main>
  );
}
