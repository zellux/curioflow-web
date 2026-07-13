import Link from "next/link";
import { archiveItemAction, refetchArticleContentAction, toggleItemSavedAction, unarchiveItemAction } from "@/app/actions";
import { appRoute, buildHref, readerItemRoute, type ReaderEntryContext } from "@/app/app-navigation";
import { DeleteItemButton } from "@/app/confirm-dialog-buttons";
import {
  estimateRead,
  fetchErrorCopy,
  formatDate,
  hostnameFor,
  isArticleFetchError,
  isArticleFetching,
  itemKindLabel,
  localeAria,
  statusLabel
} from "@/app/item-display";
import { ArchiveIcon, TrashIcon, UnarchiveIcon, WarningTriangleIcon } from "@/app/item-icons";
import { ReaderHighlighter } from "@/app/reader-highlighter";
import { ReaderProgress } from "@/app/reader-progress";
import { ReaderSummaryCard, type ArticleSummary } from "@/app/reader-summary-card";
import { ReaderToc } from "@/app/reader-toc";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import type { SystemLanguage, UiCopy } from "@/app/i18n";
import { itemShowsArchiveAction, itemShowsSaveAction } from "@/server/item-state";
import type { getInboxItems, getItemForReader } from "@/server/items";
import { getExtractionNote, sanitizeArticleHtmlWithToc } from "@/server/reader/rendering";

type InboxPage = Awaited<ReturnType<typeof getInboxItems>>;
type InboxItem = InboxPage["items"][number];

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

export function ReaderView({
  backContext,
  copy,
  item,
  items,
  llmEnabled,
  locale,
  refetched,
  summaryStatus
}: {
  backContext: ReaderEntryContext;
  copy: UiCopy;
  item: Awaited<ReturnType<typeof getItemForReader>>;
  items: InboxItem[];
  llmEnabled: boolean;
  locale: SystemLanguage;
  refetched?: string;
  summaryStatus?: string;
}) {
  if (!item) return null;

  const preparedArticle = sanitizeArticleHtmlWithToc(item.document?.articleHtml, item.document?.text, item.id);
  const readerHtml = preparedArticle.html;
  const tocItems = preparedArticle.tocItems;
  const summary = llmEnabled ? readerSummary(item.document, copy) : null;
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
  const readerShowSave = itemShowsSaveAction(item, backContext.query);
  const readerShowArchive = itemShowsArchiveAction(item, backContext.query);
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
              skipInitialRestoreKey={summary?.source === "llm" ? `curioflow-summary-pending:${item.id}` : undefined}
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
          {summary ? <ReaderSummaryCard copy={copy} itemId={item.id} locale={locale} returnTo={returnTo} summary={summary} /> : null}

          {extractionNote ? (
            <div className="extractionNote">
              {extractionNote}
            </div>
          ) : null}
          {refetched === "article" ? (
            <div className="refetchNotice">{copy.item.refetched}</div>
          ) : null}
          {llmEnabled && summaryStatus === "regenerated" ? (
            <div className="refetchNotice">{copy.item.summaryRegenerated}</div>
          ) : null}
          {llmEnabled && summaryStatus === "missing-llm" ? (
            <div className="refetchNotice isError">{copy.item.summaryMissingLlm}</div>
          ) : null}
          {llmEnabled && summaryStatus === "error" ? (
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
