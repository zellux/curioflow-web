import Link from "next/link";
import { archiveItemAction, refetchArticleContentAction, unarchiveItemAction } from "@/app/actions";
import { buildHref, readerItemRoute, type ReaderEntryContext } from "@/app/app-navigation";
import { DeleteItemButton } from "@/app/confirm-dialog-buttons";
import { FeedSaveForm } from "@/app/feed-save-form";
import {
  estimateRead,
  fetchErrorCopy,
  formatDate,
  hostnameFor,
  isArticleFetchError,
  isArticleFetching,
  itemKindLabel,
  localeAria,
  summarize
} from "@/app/item-display";
import { ArchiveIcon, ExternalLinkIcon, TrashIcon, UnarchiveIcon, WarningTriangleIcon } from "@/app/item-icons";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import type { SystemLanguage, UiCopy } from "@/app/i18n";
import { itemShowsArchiveAction, itemShowsSaveAction } from "@/server/item-state";
import type { getInboxItems } from "@/server/items";

type InboxPage = Awaited<ReturnType<typeof getInboxItems>>;
type InboxItem = InboxPage["items"][number];

function ItemCardActions({ copy, entryContext, item, locale }: { copy: UiCopy; entryContext: ReaderEntryContext; item: InboxItem; locale: SystemLanguage }) {
  const isArchived = Boolean(item.archivedAt);
  const showSave = itemShowsSaveAction(item, entryContext.query);
  const showArchive = itemShowsArchiveAction(item, entryContext.query);
  const deleteReturnTo = buildHref(entryContext.query);
  const originalUrl = item.contentObject?.normalizedUrl ?? item.url;

  return (
    <div className="feedItemActions" aria-label={copy.common.articleActions}>
      {originalUrl ? (
        <a
          aria-label={copy.common.openOriginal}
          className="feedItemActionButton"
          href={originalUrl}
          rel="noreferrer"
          target="_blank"
          title={copy.common.openOriginal}
        >
          <ExternalLinkIcon size={15} />
        </a>
      ) : null}
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

export function FeedItemCard({ copy, entryContext, item, locale }: { copy: UiCopy; entryContext: ReaderEntryContext; item: InboxItem; locale: SystemLanguage }) {
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

export function PaginationControls({
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
  });

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
