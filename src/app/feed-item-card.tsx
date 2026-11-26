import { ItemActionForm } from "@/app/item-action-form";
import Link from "next/link";
import { archiveItemAction, refetchArticleContentAction, unarchiveItemAction } from "@/app/actions";
import { buildHref, readerItemRoute, type ReaderEntryContext } from "@/app/app-navigation";
import { DeleteItemButton } from "@/app/confirm-dialog-buttons";
import { ItemStarForm } from "@/app/item-star-form";
import { starredCopy } from "@/app/starred-copy";
import { FeedSaveForm } from "@/app/feed-save-form";
import {
  formatReadTime,
  fetchErrorCopy,
  formatDate,
  hostnameFor,
  isArticleFetchError,
  isArticleFetching,
  itemKindLabel,
  summarize
} from "@/app/item-display";
import { ArchiveIcon, BookmarkFilledIcon, StarIcon, TrashIcon, UnarchiveIcon, WarningTriangleIcon } from "@/app/item-icons";
import { ReaderMoreMenu } from "@/app/reader-more-menu";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import { pickLocale, type SystemLanguage, type UiCopy } from "@/app/i18n";
import {
  isSourceStreamActionContext,
  itemHasActiveSubscription,
  itemShowsArchiveAction,
  itemShowsSaveAction,
  itemStreamDisposition,
  READING_COMPLETION_THRESHOLD,
  type ItemStreamDisposition
} from "@/server/item-state";
import type { getInboxItems } from "@/server/items";

type InboxPage = Awaited<ReturnType<typeof getInboxItems>>;
type InboxItem = InboxPage["items"][number];

const STREAM_DISPOSITION_COPY: Record<SystemLanguage, Record<ItemStreamDisposition, string>> = {
  en: { library: "In Library", archived: "Archived" },
  "zh-Hans": { library: "已在资料库", archived: "已归档" },
  "zh-Hant": { library: "已在資料庫", archived: "已封存" },
  ja: { library: "ライブラリ済み", archived: "アーカイブ済み" },
  ko: { library: "라이브러리에 있음", archived: "보관됨" }
};

export function ItemStreamStatusBadge({ disposition, locale }: { disposition: ItemStreamDisposition; locale: SystemLanguage }) {
  const label = pickLocale(locale, STREAM_DISPOSITION_COPY)[disposition];
  return (
    <span className={`feedItemStatusBadge feedItemStatusBadge--${disposition}`}>
      {disposition === "library" ? <BookmarkFilledIcon size={10} /> : <ArchiveIcon size={11} />}
      {label}
    </span>
  );
}

function ItemCardActions({ copy, entryContext, item, locale }: { copy: UiCopy; entryContext: ReaderEntryContext; item: InboxItem; locale: SystemLanguage }) {
  const isArchived = Boolean(item.archivedAt);
  const showSave = itemShowsSaveAction(item);
  const showArchive = itemShowsArchiveAction(item);
  const deleteReturnTo = buildHref(entryContext.query);

  return (
    <div className="feedItemActions" aria-label={copy.common.articleActions}>
      {showSave ? (
        <FeedSaveForm itemId={item.id} locale={locale} />
      ) : null}
      {showArchive ? (
        <ItemActionForm action={isArchived ? unarchiveItemAction : archiveItemAction} undoAction={isArchived ? archiveItemAction : unarchiveItemAction}
          values={{ itemId: item.id }} locale={locale} className="feedItemActionButton"
          message={isArchived
            ? pickLocale(locale, { en: "Restored", "zh-Hans": "已恢复", "zh-Hant": "已還原", ja: "復元しました", ko: "복원됨" })
            : pickLocale(locale, { en: "Archived", "zh-Hans": "已归档", "zh-Hant": "已封存", ja: "アーカイブしました", ko: "보관됨" })}
          label={isArchived
            ? pickLocale(locale, { en: "Restore to library", "zh-Hans": "恢复到资料库", "zh-Hant": "還原到資料庫", ja: "ライブラリに復元", ko: "라이브러리로 복원" })
            : pickLocale(locale, { en: "Archive article", "zh-Hans": "归档文章", "zh-Hant": "封存文章", ja: "記事をアーカイブ", ko: "글 보관" })}>
          {isArchived ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
        </ItemActionForm>
      ) : null}
      {showArchive ? (
        <ItemStarForm itemId={item.id} starred={item.starred} locale={locale} className="feedItemActionButton" />
      ) : null}
      {showArchive ? (
        <ReaderMoreMenu className="feedItemMore" label={copy.common.articleActions}>
          <DeleteItemButton className="readerMoreItem isDanger" itemId={item.id} itemTitle={item.title}
            locale={locale} removeFromLibrary={itemHasActiveSubscription(item)} returnTo={deleteReturnTo}>
            <TrashIcon size={15} />
            <span>{pickLocale(locale, { en: "Delete article", "zh-Hans": "删除文章", "zh-Hant": "刪除文章", ja: "記事を削除", ko: "글 삭제" })}</span>
          </DeleteItemButton>
        </ReaderMoreMenu>
      ) : null}
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
  const isRead = progress >= READING_COMPLETION_THRESHOLD;
  const showUnreadDot = !hasFetchError && !isFetching && !item.archivedAt && !showProgress;
  const showProgressBar = showProgress && !isRead;
  const inSourceStream = isSourceStreamActionContext(item, entryContext.query);
  const streamDisposition = inSourceStream
    ? itemStreamDisposition(item)
    : entryContext.query.filter === "starred" && item.archivedAt ? "archived" : null;
  const dispositionClass = streamDisposition === "library"
    ? " isInLibrary"
    : streamDisposition === "archived"
      ? " isArchived"
      : "";
  const annotationCount = item.annotationCount ?? 0;
  // On a single-source page the heading already names the source.
  const showSourceName = !(entryContext.query.source && (item.source?.type === "rss" || item.source?.type === "newsletter"));
  const progressLabel = isRead
    ? pickLocale(locale, { en: "✓ Read", "zh-Hans": "✓ 已读", "zh-Hant": "✓ 已讀", ja: "✓ 既読", ko: "✓ 읽음" })
    : `${Math.round(progress * 100)}%`;
  const progressTitle = isRead
    ? pickLocale(locale, { en: "Finished", "zh-Hans": "已读完", "zh-Hant": "已讀完", ja: "読了", ko: "읽기 완료" })
    : pickLocale(locale, {
      en: `${progressLabel} read`,
      "zh-Hans": `已读 ${progressLabel}`,
      "zh-Hant": `已讀 ${progressLabel}`,
      ja: `${progressLabel} 既読`,
      ko: `${progressLabel} 읽음`
    });
  const annotationTitle = pickLocale(locale, {
    en: `${annotationCount} ${annotationCount === 1 ? "note" : "notes"}`,
    "zh-Hans": `${annotationCount} 条笔记与高亮`,
    "zh-Hant": `${annotationCount} 則筆記與重點`,
    ja: `${annotationCount} 件のメモとハイライト`,
    ko: `메모 및 하이라이트 ${annotationCount}개`
  });

  const body = (
    <>
      <div className="itemByline feedItemByline">
        {!entryContext.query.source && !["recent-posts", "newsletters"].includes(entryContext.query.filter ?? "") ? <span className="tag">{itemKindLabel(item, copy)}</span> : null}
        {showSourceName ? (
          <>
            <strong>{item.source?.type === "rss" || item.source?.type === "newsletter" ? item.source.name : hostnameFor(item)}</strong>
            <span className="itemDateDivider">·</span>
          </>
        ) : null}
        <span className="itemDate">{formatDate(item.publishedAt ?? item.createdAt, locale, copy.common.noDate)}</span>
        {streamDisposition ? <ItemStreamStatusBadge disposition={streamDisposition} locale={locale} /> : null}
        {item.starred && streamDisposition && inSourceStream ? <span className="feedItemStatusBadge feedItemStatusBadge--library">
          <StarIcon filled size={11} />
          {starredCopy(locale).label}
        </span> : null}
        {annotationCount > 0 ? (
          <span className="itemAnnotationCount" title={annotationTitle} aria-label={annotationTitle}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            {annotationCount}
          </span>
        ) : null}
        {showProgress ? (
          <span className={`readProgressLabel${isRead ? " isRead" : ""}`} title={progressTitle}>{progressLabel}</span>
        ) : showUnreadDot ? (
          <span className="readProgressLabel isUnread" role="img" title={copy.common.unread} aria-label={copy.common.unread}>
            <span className="unreadDot" aria-hidden="true" />
          </span>
        ) : null}
        <span className="readTime">{formatReadTime(hasFetchError || isFetching ? null : item.readingMinutes, locale)}</span>
      </div>
      <h2>{item.title}</h2>
      <p>{hasFetchError ? copy.item.articleFetchFailed : summarize(item.document?.text, copy)}</p>
    </>
  );

  if (!hasFetchError && !isFetching) {
    return (
      <article className={`feedItem${isRead ? " isRead" : ""}${dispositionClass}`}>
        <Link className="feedItemMain" href={href}>
          {body}
        </Link>
        <ItemCardActions copy={copy} entryContext={entryContext} item={item} locale={locale} />
        {showProgressBar ? (
          <span className="feedItemProgressBar" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        ) : null}
      </article>
    );
  }

  return (
    <article className={`feedItem feedItemState${dispositionClass}`}>
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
  if (pagination.pageCount <= 1) return null;

  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.total, pagination.page * pagination.pageSize);
  const pageHref = (page: number) => buildHref({
    ...entryContext.query,
    page: page > 1 ? String(page) : undefined
  });

  return (
    <nav
      className="paginationControls"
      aria-label={pickLocale(copy.locale, {
        en: "Article pages",
        "zh-Hans": "文章分页",
        "zh-Hant": "文章分頁",
        ja: "記事のページ移動",
        ko: "글 페이지 이동"
      })}
    >
      <span>
        {pickLocale(copy.locale, {
          en: `${start}-${end} of ${pagination.total}`,
          "zh-Hans": `${start}-${end}，共 ${pagination.total}`,
          "zh-Hant": `${start}-${end}，共 ${pagination.total}`,
          ja: `${start}–${end} / 全 ${pagination.total} 件`,
          ko: `전체 ${pagination.total}개 중 ${start}-${end}`
        })}
      </span>
      <div>
        {pagination.page > 1 ? (
          <Link href={pageHref(pagination.page - 1)}>{copy.common.previous}</Link>
        ) : (
          <span aria-disabled="true">{copy.common.previous}</span>
        )}
        <strong>
          {pickLocale(copy.locale, {
            en: `Page ${pagination.page} of ${pagination.pageCount}`,
            "zh-Hans": `第 ${pagination.page} 页 / 共 ${pagination.pageCount} 页`,
            "zh-Hant": `第 ${pagination.page} 頁 / 共 ${pagination.pageCount} 頁`,
            ja: `${pagination.page} / ${pagination.pageCount} ページ`,
            ko: `${pagination.page} / ${pagination.pageCount}페이지`
          })}
        </strong>
        {pagination.page < pagination.pageCount ? (
          <Link href={pageHref(pagination.page + 1)}>{copy.common.next}</Link>
        ) : (
          <span aria-disabled="true">{copy.common.next}</span>
        )}
      </div>
    </nav>
  );
}
