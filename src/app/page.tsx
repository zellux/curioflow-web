import Link from "next/link";
import { addRssSourceAction, saveUrlAction, updateReadStatusAction } from "@/app/actions";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtml } from "@/server/reader/rendering";
import { getLibrarySources } from "@/server/sources";

type HomeProps = {
  searchParams?: Promise<{ item?: string }>;
};

type InboxItem = Awaited<ReturnType<typeof getInboxItems>>[number];

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

function Sidebar({
  counts,
  sources,
  activeItemId,
  userName
}: {
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  activeItemId?: string;
  userName: string;
}) {
  const rssSources = sources.filter((source) => source.type === "rss");
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;

  return (
    <aside className="sidebar" aria-label="Library navigation">
      <Link className="brand" href="/">
        <span className="brandMark"><span /></span>
        <strong>Curioflow</strong>
      </Link>

      <Link className="addSourceButton" href="#add-source">+ Add source</Link>

      <nav className="navList">
        <Link className={!activeItemId ? "active" : ""} href="/">
          <span className="navIcon">☰</span>
          Library
        </Link>
        <Link href="/#brief">
          <span className="navIcon">☼</span>
          Daily Briefing
        </Link>
        <Link href="/#ask">
          <span className="navIcon">⌕</span>
          Ask your library
        </Link>
      </nav>

      <section className="sideGroup">
        <h2>Feeds</h2>
        {rssSources.slice(0, 8).map((source) => (
          <Link className="sideRow" href="/" key={source.id}>
            <span>{source.name}</span>
            <strong>{source._count.items}</strong>
          </Link>
        ))}
        {rssSources.length === 0 ? <p className="sideEmpty">No feeds yet</p> : null}
      </section>

      <section className="sideGroup">
        <h2>Library</h2>
        <Link className="sideRow" href="/">
          <span>Saved URLs</span>
          <strong>{savedUrlCount}</strong>
        </Link>
        <Link className="sideRow" href="/">
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

function AddSourceDialog() {
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
          <form action={addRssSourceAction} className="sourceForm">
            <label htmlFor="rss-url">Feed or site URL</label>
            <input id="rss-url" name="url" type="url" placeholder="https://example.com/feed.xml" required />
            <div className="sourcePreview">
              <span className="previewIcon">◔</span>
              <div>
                <strong>RSS feed</strong>
                <small>Creates a feed source and imports current articles.</small>
              </div>
            </div>
            <button type="submit">Add RSS feed</button>
          </form>

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

          <div className="sourceForm sourceFormDisabled">
            <label>PDF</label>
            <div className="pdfDrop">
              <span>PDF</span>
              <strong>Drop a PDF, or click to choose</strong>
              <small>Up to 50 MB · parsed into reading text</small>
            </div>
            <button type="button" disabled>PDF upload next</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Topbar({ isReader }: { isReader: boolean }) {
  return (
    <header className="topbar">
      <span>{isReader ? "Library / Reading" : "Library"}</span>
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
  counts
}: {
  items: InboxItem[];
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
}) {
  const savedUrlCount = sources.find((source) => source.id === "manual-url-source")?._count.items ?? 0;
  const rssSourceCount = sources.filter((source) => source.type === "rss").length;

  return (
    <div className="libraryView">
      <div className="libraryHeading">
        <div>
          <h1>Library</h1>
          <p>{counts.ready} indexed · {counts.unread} unread · {counts.jobs.length} recent jobs</p>
        </div>
        <span>{items.length} saved</span>
      </div>

      <div className="searchShell">
        <span>⌕</span>
        <input placeholder="Search your library..." disabled />
      </div>

      <div className="chips">
        <span className="active">All</span>
        <span>Unread</span>
        <span>Indexed</span>
        <span>{savedUrlCount} Saved URLs</span>
        <span>{rssSourceCount} RSS feeds</span>
      </div>

      <section className="briefPreview" id="brief">
        <div>
          <small>Daily Briefing</small>
          <h2>Good morning. Here is what you have been thinking about.</h2>
          <p>Your first generated briefing will draw from saved and unread items.</p>
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
        <h2>Ask your library</h2>
        <p>Answers will cite saved documents once retrieval is connected.</p>
      </section>
    </div>
  );
}

function ReaderView({
  item,
  items
}: {
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
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
          <form action={updateReadStatusAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="readStatus" value="done" />
            <button className="ghostButton" type="submit">Save</button>
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
  const [user, library, items, readerItem, counts, sources] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(),
    getItemForReader(params?.item),
    getDashboardCounts(),
    getLibrarySources()
  ]);

  const isReader = Boolean(readerItem);

  return (
    <main className="appShell">
      <Sidebar counts={counts} sources={sources} activeItemId={readerItem?.id} userName={user.displayName} />

      <section className="mainShell" aria-label={library.name}>
        <Topbar isReader={isReader} />
        <div className="scrollArea">
          {readerItem ? <ReaderView item={readerItem} items={items} /> : <LibraryView items={items} sources={sources} counts={counts} />}
        </div>
      </section>
      <AddSourceDialog />
    </main>
  );
}
