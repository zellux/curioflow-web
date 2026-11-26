import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import { translationSourceHash } from "@/server/translation-content";
import { ResetReadingButton } from "@/app/reset-reading-button";
import { getNextRssItem } from "@/server/reader-next";
import { ItemStarForm } from "@/app/item-star-form";
import { ItemActionForm } from "@/app/item-action-form";
import Link from "next/link";
import { Suspense } from "react";
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
  statusLabel
} from "@/app/item-display";
import { ArchiveIcon, BookmarkIcon, ExternalLinkIcon, TrashIcon, UnarchiveIcon, WarningTriangleIcon } from "@/app/item-icons";
import { ReaderFocusToggle } from "@/app/reader-focus-toggle";
import { ReaderHighlighter } from "@/app/reader-highlighter";
import { ReaderKeyboardNavigation } from "@/app/reader-keyboard-navigation";
import { ReaderMoreMenu } from "@/app/reader-more-menu";
import { PdfReader } from "@/app/pdf-reader";
import "./pdf-reader.css";
import { ReaderProgress, ReaderReturnToTopButton } from "@/app/reader-progress";
import { ReaderSummaryCard, type ArticleSummary } from "@/app/reader-summary-card";
import { readingLanguage } from "@/app/reader-language";
import { ReaderTranslationProvider, ReaderTranslationButton, ReaderTranslationTitle, ReaderTranslationBody } from "@/app/reader-translation";
import { RefetchArticleForm } from "@/app/refetch-article-form";
import { pickLocale, type SystemLanguage, type UiCopy } from "@/app/i18n";
import { ItemStreamStatusBadge } from "@/app/feed-item-card";
import { isSourceStreamActionContext, itemHasActiveSubscription, itemShowsArchiveAction, itemShowsRemovalAction, itemShowsSaveAction, itemStreamDisposition } from "@/server/item-state";
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

const READER_VIEW_COPY: Record<SystemLanguage, {
  archiveAndNext: string;
  archiveArticle: string;
  archivePdf: string;
  archived: string;
  askAbout: string;
  askShort: string;
  backTo: (label: string) => string;
  continueReading: string;
  deleteArticle: string;
  deletePdf: string;
  moreActions: string;
  nextArticle: string;
  openOriginalPdf: string;
  restoreLibrary: string;
  restorePdf: string;
  restoreSourceInbox: string;
  restored: string;
  saveShort: string;
  savedToLibrary: string;
}> = {
  en: {
    archiveAndNext: "Archive & read next",
    archiveArticle: "Archive article (E)",
    archivePdf: "Archive PDF",
    archived: "Archived",
    askAbout: "Ask about this",
    askShort: "Ask",
    backTo: (label) => `Back to ${label}`,
    continueReading: "Continue reading",
    deleteArticle: "Delete article",
    deletePdf: "Delete PDF",
    moreActions: "More actions",
    nextArticle: "Next article",
    openOriginalPdf: "Open original PDF",
    restoreLibrary: "Restore to library (E)",
    restorePdf: "Restore PDF",
    restoreSourceInbox: "Restore to source inbox (E)",
    restored: "Restored",
    saveShort: "Save",
    savedToLibrary: "Saved to library"
  },
  "zh-Hans": {
    archiveAndNext: "归档并读下一篇",
    archiveArticle: "归档文章 (E)",
    archivePdf: "归档 PDF",
    archived: "已归档",
    askAbout: "询问这篇文章",
    askShort: "提问",
    backTo: (label) => `返回${label}`,
    continueReading: "继续阅读",
    deleteArticle: "删除文章",
    deletePdf: "删除 PDF",
    moreActions: "更多操作",
    nextArticle: "下一篇",
    openOriginalPdf: "打开原 PDF",
    restoreLibrary: "恢复到资料库 (E)",
    restorePdf: "恢复 PDF",
    restoreSourceInbox: "恢复到来源收件箱 (E)",
    restored: "已恢复",
    saveShort: "保存",
    savedToLibrary: "已保存到资料库"
  },
  "zh-Hant": {
    archiveAndNext: "封存並讀下一篇",
    archiveArticle: "封存文章 (E)",
    archivePdf: "封存 PDF",
    archived: "已封存",
    askAbout: "詢問這篇文章",
    askShort: "提問",
    backTo: (label) => `返回${label}`,
    continueReading: "繼續閱讀",
    deleteArticle: "刪除文章",
    deletePdf: "刪除 PDF",
    moreActions: "更多操作",
    nextArticle: "下一篇",
    openOriginalPdf: "開啟原 PDF",
    restoreLibrary: "還原到資料庫 (E)",
    restorePdf: "還原 PDF",
    restoreSourceInbox: "還原到來源收件匣 (E)",
    restored: "已還原",
    saveShort: "儲存",
    savedToLibrary: "已儲存到資料庫"
  },
  ja: {
    archiveAndNext: "アーカイブして次を読む",
    archiveArticle: "記事をアーカイブ (E)",
    archivePdf: "PDF をアーカイブ",
    archived: "アーカイブしました",
    askAbout: "この記事について質問",
    askShort: "質問",
    backTo: (label) => `${label}に戻る`,
    continueReading: "続けて読む",
    deleteArticle: "記事を削除",
    deletePdf: "PDF を削除",
    moreActions: "その他の操作",
    nextArticle: "次の記事",
    openOriginalPdf: "元の PDF を開く",
    restoreLibrary: "ライブラリに戻す (E)",
    restorePdf: "PDF を復元",
    restoreSourceInbox: "ソース受信箱に戻す (E)",
    restored: "復元しました",
    saveShort: "保存",
    savedToLibrary: "ライブラリに保存しました"
  },
  ko: {
    archiveAndNext: "보관하고 다음 글 읽기",
    archiveArticle: "글 보관 (E)",
    archivePdf: "PDF 보관",
    archived: "보관됨",
    askAbout: "이 글에 대해 질문",
    askShort: "질문",
    backTo: (label) => `${label}(으)로 돌아가기`,
    continueReading: "계속 읽기",
    deleteArticle: "글 삭제",
    deletePdf: "PDF 삭제",
    moreActions: "더 보기",
    nextArticle: "다음 글",
    openOriginalPdf: "원본 PDF 열기",
    restoreLibrary: "라이브러리로 복원 (E)",
    restorePdf: "PDF 복원",
    restoreSourceInbox: "소스 받은편지함으로 복원 (E)",
    restored: "복원됨",
    saveShort: "저장",
    savedToLibrary: "라이브러리에 저장됨"
  }
};

export async function ReaderView({
  backContext,
  copy,
  item,
  loadRelatedItems,
  llmEnabled,
  locale,
  refetched,
  summaryStatus
}: {
  backContext: ReaderEntryContext;
  copy: UiCopy;
  item: Awaited<ReturnType<typeof getItemForReader>>;
  loadRelatedItems: () => Promise<InboxPage>;
  llmEnabled: boolean;
  locale: SystemLanguage;
  refetched?: string;
  summaryStatus?: string;
}) {
  if (!item) return null;
  const rCopy = pickLocale(locale, READER_VIEW_COPY);

  if (item.type === "pdf") {
    const pdfUrl = `/api/items/${encodeURIComponent(item.id)}/pdf`;
    const archived = Boolean(item.archivedAt);
    const archiveLabel = archived ? rCopy.restorePdf : rCopy.archivePdf;
    return <article className="pdfReaderView">
      <header className="pdfReaderHeader">
        <Link className="pdfBack" href={appRoute(backContext.query)} title={backContext.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          <span>{backContext.label}</span>
        </Link>
        <h1 title={item.title}>{item.title}</h1>
        <ItemStarForm itemId={item.id} starred={item.starred} locale={locale} className="readerIconButton" />
        <ReaderMoreMenu className="pdfMore" label={rCopy.moreActions}>
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="readerMoreItem" role="menuitem">
            <ExternalLinkIcon size={15} />
            <span>{rCopy.openOriginalPdf}</span>
          </a>
          <ResetReadingButton itemId={item.id} locale={locale} />
          {itemShowsArchiveAction(item) ? (
            <ItemActionForm action={archived ? unarchiveItemAction : archiveItemAction} undoAction={archived ? archiveItemAction : unarchiveItemAction}
              values={{ itemId: item.id }} locale={locale} className="readerMoreItem"
              message={archived ? rCopy.restored : rCopy.archived} label={archiveLabel}>
              {archived ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
              <span>{archiveLabel}</span>
            </ItemActionForm>
          ) : null}
          {itemShowsSaveAction(item) ? (
            <ItemActionForm action={toggleItemSavedAction} undoAction={toggleItemSavedAction}
              values={{ itemId: item.id, savedToLibrary: "true" }} undoValues={{ itemId: item.id, savedToLibrary: "false" }}
              locale={locale} message={rCopy.savedToLibrary} label={copy.common.saveToLibrary} className="readerMoreItem">
              <BookmarkIcon size={15} />
              <span>{copy.common.saveToLibrary}</span>
            </ItemActionForm>
          ) : null}
          {itemShowsRemovalAction(item) ? (
            <>
              <div className="readerMoreDivider" role="separator" />
              <DeleteItemButton className="readerMoreItem isDanger" itemId={item.id} itemTitle={item.title} locale={locale} returnTo={buildHref(backContext.query)} removeFromLibrary={itemHasActiveSubscription(item)} title={rCopy.deletePdf}>
                <TrashIcon size={15} />
                <span>{rCopy.deletePdf}</span>
              </DeleteItemButton>
            </>
          ) : null}
        </ReaderMoreMenu>
      </header>
      <PdfReader key={item.id} itemId={item.id} locale={locale} positionJson={item.readingPositionJson}
        initialProgress={item.readingProgress} annotations={item.annotations.map(({ id, note, quote, locationJson }) => ({ id, note, quote, locationJson }))} />
    </article>;
  }

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
  const nextItem = await getNextRssItem(item, backContext.query);
  const nextHref = nextItem ? readerItemRoute(nextItem.id, backContext) : undefined;
  const readerBodyId = `reader-body-${item.id}`;
  const originalLanguage = readingLanguage(item.document?.language, item.document?.text);
  const returnTo = buildHref({ ...backContext.query, item: item.id });
  const deleteReturnTo = buildHref(backContext.query);
  const readerShowSave = itemShowsSaveAction(item);
  const readerShowArchive = itemShowsArchiveAction(item);
  const readerShowRemoval = itemShowsRemovalAction(item);
  const readerDisposition = isSourceStreamActionContext(item, backContext.query)
    ? itemStreamDisposition(item)
    : item.archivedAt
      ? "archived"
      : null;
  const annotations = item.annotations.map((annotation) => ({
    id: annotation.id,
    quote: annotation.quote,
    note: annotation.note,
    locationJson: annotation.locationJson,
    createdAt: annotation.createdAt.toISOString()
  }));

  return (
    <ReaderTranslationProvider key={`${item.id}:${translationSourceHash(item)}`} itemId={item.id} locale={locale}>
    <article className="readerView">
      <ReaderKeyboardNavigation targetId={readerBodyId} />
      <div className="readerToolbar">
        <Link href={appRoute(backContext.query)} className="readerBackButton" title={rCopy.backTo(backContext.label)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="m14 6-6 6 6 6" />
          </svg>
          <span>{backContext.label}</span>
        </Link>
        <div>
          {SHOW_DRAFT_READING_TOOLS && llmEnabled ? <Link className="saveToggleButton" href={buildHref({ view: "ask", scopeItem: item.id })}><span className="readerActionFull">{rCopy.askAbout}</span><span className="readerActionShort">{rCopy.askShort}</span></Link> : null}
          <ReaderHighlighter annotations={annotations} itemId={item.id} itemTitle={item.title} targetId={readerBodyId} />
          {readerShowArchive ? (
            <span data-reader-archive="">
              <ItemActionForm action={item.archivedAt ? unarchiveItemAction : archiveItemAction} undoAction={item.archivedAt ? archiveItemAction : unarchiveItemAction}
                values={{ itemId: item.id }} locale={locale} className="readerIconButton"
                message={item.archivedAt ? rCopy.restored : rCopy.archived}
                label={item.archivedAt ? rCopy.restoreLibrary : rCopy.archiveArticle}>
                {item.archivedAt ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
              </ItemActionForm>
            </span>
          ) : null}
          <ItemStarForm itemId={item.id} starred={item.starred} locale={locale} className="readerIconButton" />
          <ReaderMoreMenu label={rCopy.moreActions}>
            {!hasFetchError && !isFetching ? <ReaderReturnToTopButton locale={locale} targetId={readerBodyId} /> : null}
            {item.type === "article" && item.document?.text && !hasFetchError && !isFetching ? <ReaderTranslationButton variant="menu" /> : null}
            <ReaderFocusToggle locale={locale} variant="menu" />
            <div className="readerMoreDivider" role="separator" />
            <ResetReadingButton itemId={item.id} locale={locale} />
            {item.type === "article" && item.url ? (
              <RefetchArticleForm action={refetchArticleContentAction} itemId={item.id} locale={locale} returnTo={returnTo} variant="menu" />
            ) : null}
            {readerShowRemoval ? (
              <>
                <div className="readerMoreDivider" role="separator" />
                <DeleteItemButton className="readerMoreItem isDanger" itemId={item.id} itemTitle={item.title} locale={locale} returnTo={deleteReturnTo} removeFromLibrary={itemHasActiveSubscription(item)} title={rCopy.deleteArticle}>
                  <TrashIcon size={15} />
                  <span>{rCopy.deleteArticle}</span>
                </DeleteItemButton>
              </>
            ) : null}
          </ReaderMoreMenu>
          {readerShowSave ? (
            <span data-reader-save="">
              <ItemActionForm action={toggleItemSavedAction} undoAction={toggleItemSavedAction}
                values={{ itemId: item.id, savedToLibrary: "true" }} undoValues={{ itemId: item.id, savedToLibrary: "false" }}
                locale={locale} message={rCopy.savedToLibrary} label={`${copy.common.saveToLibrary} (S)`} className="saveToggleButton">
                <span className="readerActionFull">{copy.common.saveToLibrary}</span><span className="readerActionShort">{rCopy.saveShort}</span>
              </ItemActionForm>
            </span>
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
        {readerDisposition ? <ItemStreamStatusBadge disposition={readerDisposition} locale={locale} /> : null}
      </div>

      <ReaderTranslationTitle title={item.title} originalLanguage={originalLanguage} />

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
          <ReaderTranslationBody html={readerHtml} text={item.document?.text ?? copy.item.fullTextPending} tocItems={tocItems} targetId={readerBodyId} originalLanguage={originalLanguage} />

          {originalUrl ? (
            <a className="originButton" href={originalUrl} target="_blank" rel="noreferrer">
              {copy.common.openOriginal}
            </a>
          ) : null}
        </>
      ) : null}

      {nextItem ? <div className="readerNext">
        <Link href={nextHref!}>{rCopy.nextArticle}: {nextItem.title}</Link>
        {readerShowArchive && !item.archivedAt ? <ItemActionForm action={archiveItemAction} undoAction={unarchiveItemAction} values={{ itemId: item.id }}
          nextHref={nextHref} locale={locale} className="readerFinishButton"
          message={rCopy.archived} label={rCopy.archiveAndNext}>
          {rCopy.archiveAndNext}
        </ItemActionForm> : null}
      </div> : null}
      {!nextItem ? <Suspense fallback={null}>
        <RelatedItems loadItems={loadRelatedItems} itemId={item.id} backContext={backContext} locale={locale} />
      </Suspense> : null}
    </article>
    </ReaderTranslationProvider>
  );
}


async function RelatedItems({ loadItems, itemId, backContext, locale }: {
  loadItems: () => Promise<InboxPage>;
  itemId: string;
  backContext: ReaderEntryContext;
  locale: SystemLanguage;
}) {
  const { items } = await loadItems();
  const related = items.filter(item => item.id !== itemId).slice(0, 3);
  return <section className="relatedBlock">
    <h2>{pickLocale(locale, READER_VIEW_COPY).continueReading}</h2>
    {related.length === 0 ? <Link href={appRoute(backContext.query)}>{backContext.label}</Link> : related.map(item => (
      <Link href={readerItemRoute(item.id, backContext)} key={item.id}>
        <span>{hostnameFor(item)}</span>
        <strong>{item.title}</strong>
        <em>{formatReadTime(item.readingMinutes, locale)}</em>
      </Link>
    ))}
  </section>;
}
