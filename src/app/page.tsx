import Link from "next/link";
import { saveUrlAction, updateReadStatusAction } from "@/app/actions";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtml } from "@/server/reader/rendering";

type HomeProps = {
  searchParams?: Promise<{ item?: string }>;
};

function formatDate(date: Date | string | null) {
  if (!date) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function statusLabel(status: string) {
  if (status === "ready") return "Ready";
  if (status === "pending") return "Queued";
  if (status === "failed") return "Needs retry";
  return status;
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

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const [user, library, items, readerItem, counts] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(),
    getItemForReader(params?.item),
    getDashboardCounts()
  ]);
  const readerDocument = readerItem?.document;
  const readerHtml = sanitizeArticleHtml(readerDocument?.articleHtml);
  const extractionNote = getExtractionNote(readerDocument?.metadataJson);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Library navigation">
        <div className="brand">
          <span className="brandMark">C</span>
          <div>
            <strong>Curioflow</strong>
            <span>{library.name}</span>
          </div>
        </div>

        <nav className="navList">
          <a className="active" href="#inbox">Today / Inbox</a>
          <a href="#brief">Daily brief</a>
          <a href="#reader">Reader</a>
          <a href="#ask">Ask library</a>
        </nav>

        <div className="sourcePanel">
          <span className="label">Sources</span>
          <button className="sourceButton" type="button">Saved URLs</button>
          <button className="sourceButton muted" type="button">RSS soon</button>
          <button className="sourceButton muted" type="button">PDF soon</button>
        </div>

        <div className="accountPanel">
          <span className="label">Workspace</span>
          <strong>{user.displayName}</strong>
          <small>Default account, auth-ready data shape</small>
        </div>
      </aside>

      <section className="inboxPane" id="inbox">
        <header className="paneHeader">
          <div>
            <p className="eyebrow">Today</p>
            <h1>Inbox</h1>
          </div>
          <div className="metricStrip" aria-label="Library metrics">
            <span><strong>{counts.total}</strong> saved</span>
            <span><strong>{counts.unread}</strong> unread</span>
            <span><strong>{counts.ready}</strong> ready</span>
          </div>
        </header>

        <form action={saveUrlAction} className="addUrlForm">
          <input
            name="url"
            type="url"
            placeholder="Paste a URL to save"
            aria-label="URL to save"
            required
          />
          <button type="submit">Save URL</button>
        </form>

        <section className="briefBand" id="brief">
          <div>
            <span className="label">Daily brief</span>
            <h2>Your first brief will use saved and unread items.</h2>
          </div>
          <span className="briefPill">Generator reserved</span>
        </section>

        <div className="itemList">
          {items.length === 0 ? (
            <div className="emptyState">
              <h2>Save the first article to open the reader.</h2>
              <p>The MVP uses a mock extractor when offline, but it still creates the reusable content object, document, chunks, and ingestion job trail.</p>
            </div>
          ) : (
            items.map((item) => (
              <Link
                className={`itemRow ${readerItem?.id === item.id ? "selected" : ""}`}
                href={`/?item=${item.id}`}
                key={item.id}
              >
                <div className="itemTopline">
                  <span>{item.source?.name ?? "Library"}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.document?.text.slice(0, 150) ?? "Waiting for extraction..."}</p>
                <div className="itemMeta">
                  <span>{statusLabel(item.status)}</span>
                  <span>{item.readStatus}</span>
                  <span>{item.document?.chunks.length ?? 0} chunks</span>
                </div>
              </Link>
            ))
          )}
        </div>

        <section className="jobList" aria-label="Recent ingestion jobs">
          <span className="label">Recent jobs</span>
          {counts.jobs.length === 0 ? (
            <p>No jobs yet.</p>
          ) : (
            counts.jobs.map((job) => (
              <div className="jobRow" key={job.id}>
                <span>{job.type}</span>
                <strong>{job.status}</strong>
              </div>
            ))
          )}
        </section>
      </section>

      <article className="readerPane" id="reader">
        {readerItem ? (
          <>
            <header className="readerHeader">
              <div className="readerKicker">
                <span>{readerItem.contentObject?.normalizedUrl ? new URL(readerItem.contentObject.normalizedUrl).hostname : "Curioflow"}</span>
                <span>{statusLabel(readerItem.status)}</span>
              </div>
              <h1>{readerItem.title}</h1>
              <div className="readerActions">
                <form action={updateReadStatusAction}>
                  <input type="hidden" name="itemId" value={readerItem.id} />
                  <input type="hidden" name="readStatus" value="reading" />
                  <button type="submit">Reading</button>
                </form>
                <form action={updateReadStatusAction}>
                  <input type="hidden" name="itemId" value={readerItem.id} />
                  <input type="hidden" name="readStatus" value="done" />
                  <button type="submit">Done</button>
                </form>
                {readerItem.url ? (
                  <a href={readerItem.url} target="_blank" rel="noreferrer">Original</a>
                ) : null}
              </div>
            </header>

            {extractionNote ? (
              <div className={`extractionNote ${readerDocument?.parserVersion === "mock-url-v1" ? "warning" : ""}`}>
                {extractionNote}
              </div>
            ) : null}

            <div className="readerBody readerArticle">
              {readerHtml ? (
                <div dangerouslySetInnerHTML={{ __html: readerHtml }} />
              ) : (
                <PlainTextArticle text={readerDocument?.text ?? "This item is still waiting for a document."} />
              )}
            </div>

            <section className="cacheDetails">
              <span className="label">Content cache</span>
              <dl>
                <div>
                  <dt>Canonical key</dt>
                  <dd>{readerItem.contentObject?.canonicalKey ?? "Not linked"}</dd>
                </div>
                <div>
                  <dt>Document</dt>
                  <dd>{readerItem.documentId ?? "Pending"}</dd>
                </div>
                <div>
                  <dt>Parser</dt>
                  <dd>{readerItem.document?.parserVersion ?? "Queued"}</dd>
                </div>
              </dl>
            </section>

            <section className="askPanel" id="ask">
              <span className="label">Ask</span>
              <input disabled placeholder="Question answering will search this library's chunks" />
            </section>
          </>
        ) : (
          <div className="readerEmpty">
            <p className="eyebrow">Reader</p>
            <h1>No item selected.</h1>
            <p>Save a URL and the reader opens the item with its cached document attached.</p>
          </div>
        )}
      </article>
    </main>
  );
}
