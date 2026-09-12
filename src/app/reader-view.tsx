import { ResetReadingButton } from "@/app/reset-reading-button";
import { getNextRssItem } from "@/server/reader-next";
import { ItemActionForm } from "@/app/item-action-form";
import Link from "next/link";
import { archiveItemAction, refetchArticleContentAction, toggleItemSavedAction, unarchiveItemAction } from "@/app/actions";
import { appRoute, buildHref, readerItemRoute, type ReaderEntryContext } from "@/app/app-navigation";
import { DeleteItemButton } from "@/app/confirm-dialog-buttons";
import {
  estimateRead,
  formatReadTime,
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
import { ReaderKeyboardNavigation } from "@/app/reader-keyboard-navigation";
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

export async function ReaderView({
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
  const related = items.filter((other) => other.id !== item.id).slice(0, 3);
  const nextItem = await getNextRssItem(item, backContext.query);
  const nextHref = nextItem ? readerItemRoute(nextItem.id, backContext) : undefined;
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
      <ReaderKeyboardNavigation targetId={readerBodyId} />
      <Link href={appRoute(backContext.query)} className="readerBackButton" title={localeAria(copy, `Back to ${backContext.label}`, `返回${backContext.label}`)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="m14 6-6 6 6 6" />
        </svg>
        {backContext.label}
      </Link>
      <div className="readerToolbar">
        <div>
          {llmEnabled ? <Link className="saveToggleButton" href={buildHref({ view: "ask", scopeItem: item.id })}><span className="readerActionFull">{locale === "zh-Hans" ? "询问这篇文章" : "Ask about this"}</span><span className="readerActionShort">{locale === "zh-Hans" ? "提问" : "Ask"}</span></Link> : null}
          <ReaderHighlighter annotations={annotations} itemId={item.id} itemTitle={item.title} targetId={readerBodyId} />
          {readerShowArchive ? (
            <ItemActionForm action={item.archivedAt ? unarchiveItemAction : archiveItemAction} undoAction={item.archivedAt ? archiveItemAction : unarchiveItemAction}
              values={{ itemId: item.id }} locale={locale} className="readerIconButton"
              message={item.archivedAt ? (locale === "zh-Hans" ? "已恢复" : "Restored") : (locale === "zh-Hans" ? "已归档" : "Archived")}
              label={item.archivedAt ? (locale === "zh-Hans" ? (item.savedToLibrary ? "恢复到资料库" : "恢复到来源收件箱") : (item.savedToLibrary ? "Restore to library" : "Restore to source inbox")) : (locale === "zh-Hans" ? "归档文章" : "Archive article")}>
              {item.archivedAt ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
            </ItemActionForm>
          ) : null}
          <details className="readerMore">
            <summary className="readerIconButton" aria-label={locale === "zh-Hans" ? "更多操作" : "More actions"}>···</summary>
            <div className="readerMoreMenu">
              <ResetReadingButton itemId={item.id} locale={locale} />
          {item.type === "article" && item.url ? (
            <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} locale={locale} returnTo={returnTo} variant="menu" />
          ) : null}
          <DeleteItemButton className="readerIconButton isDanger" itemId={item.id} itemTitle={item.title} locale={locale} returnTo={deleteReturnTo}>
            <TrashIcon size={15} /> {locale === "zh-Hans" ? "删除文章" : "Delete article"}
          </DeleteItemButton>
            </div>
          </details>
          {readerShowSave ? (
            <ItemActionForm action={toggleItemSavedAction} undoAction={toggleItemSavedAction}
              values={{ itemId: item.id, savedToLibrary: "true" }} undoValues={{ itemId: item.id, savedToLibrary: "false" }}
              locale={locale} message={locale === "zh-Hans" ? "已保存到资料库" : "Saved to library"} label={copy.common.saveToLibrary} className="saveToggleButton">
              <span className="readerActionFull">{copy.common.saveToLibrary}</span><span className="readerActionShort">{locale === "zh-Hans" ? "保存" : "Save"}</span>
            </ItemActionForm>
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
              key={item.id}
              archiveAction={archiveItemAction}
              archived={Boolean(item.archivedAt)}
              canArchive={Boolean(readerShowArchive)}
              initialProgress={item.readingProgress}
              initialPositionJson={item.readingPositionJson}
              itemId={item.id}
              locale={locale}
              readTime={estimateRead(item.document?.text, locale)}
              nextHref={nextHref}
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

      {nextItem ? <div className="readerNext">
        <Link href={nextHref!}>{locale === "zh-Hans" ? "下一篇" : "Next article"}: {nextItem.title}</Link>
        <ItemActionForm action={archiveItemAction} undoAction={unarchiveItemAction} values={{ itemId: item.id }}
          nextHref={nextHref} locale={locale} className="readerFinishButton"
          message={locale === "zh-Hans" ? "已归档" : "Archived"} label={locale === "zh-Hans" ? "归档并读下一篇" : "Archive & read next"}>
          {locale === "zh-Hans" ? "归档并读下一篇" : "Archive & read next"}
        </ItemActionForm>
      </div> : null}
      {!nextItem ? <section className="relatedBlock">
        <h2>{locale === "zh-Hans" ? "继续阅读" : "Continue reading"}</h2>
        {related.length === 0 ? (
          <Link href={appRoute(backContext.query)}>{backContext.label}</Link>
        ) : (
          related.map((relatedItem) => (
            <Link href={readerItemRoute(relatedItem.id, backContext)} key={relatedItem.id}>
              <span>{hostnameFor(relatedItem)}</span>
              <strong>{relatedItem.title}</strong>
              <em>{formatReadTime(relatedItem.readingMinutes, locale)}</em>
            </Link>
          ))
        )}
      </section> : null}
    </article>
  );
}
