import { LibraryScrollRestorer } from "@/app/library-scroll-restorer";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { cookies } from "next/headers";
import {
  addPodcastSourceAction,
  importOpmlSourcesAction,
  addRssSourceAction,
  askLibraryAction,
  saveUrlAction,
  uploadPdfAction
} from "@/app/actions";
import { buildHref, readerItemRoute, type ReaderEntryContext } from "@/app/app-navigation";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getDashboardCounts, getInboxItems, getItemForReader } from "@/server/items";
import { getLibrarySources } from "@/server/sources";
import { getOrCreateTodayBrief } from "@/server/briefs";
import { getChatThread, getChatThreads } from "@/server/chat";
import { parseChatMessageEvidence } from "@/server/chat-protocol";
import { getConnectionSettings } from "@/server/connections";
import { getLlmSettingsForCurrentAccount } from "@/server/settings";
import { readingMinutes } from "@/server/reading-time";
import { getRecentDigestItems, getTodayReadableSaveCount } from "@/server/digest";
import { readLlmSummaryFromMetadata } from "@/server/summary-metadata";
import { DeleteChatThreadButton, UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { FeedAutoSaveToggle } from "@/app/feed-auto-save-toggle";
import { FeedItemCard, PaginationControls } from "@/app/feed-item-card";
import { JobStatusRefresh } from "@/app/job-status-refresh";
import { JobStatusStrip } from "@/app/job-status-strip";
import { ReaderView } from "@/app/reader-view";
import {
  estimateRead,
  formatReadTime,
  formatDate,
  hostnameFor,
  isSummaryGenerationPending,
  itemKindLabel,
  summarize
} from "@/app/item-display";
import { Sidebar } from "@/app/sidebar";
import { SettingsDialog } from "@/app/settings-dialog";
import { AddSourceDialog } from "@/app/add-source-dialog";
import { MobileAppShell } from "@/app/mobile-app-shell";
import { NavigationFeedback } from "@/app/navigation-feedback";
import { NewsletterSourceActions } from "@/app/newsletter-source-actions";
import { AskScrollAnchor } from "@/app/ask-scroll-anchor";
import { AskComposer } from "@/app/ask-composer";
import { AskMessageActions } from "@/app/ask-message-actions";
import { getUiCopy, normalizeSystemLanguage, type SystemLanguage, type UiCopy } from "@/app/i18n";
import type { ReadingStyleInitialState } from "@/app/reading-style-settings";

export type PageSearchParams = {
  add?: string;
  filter?: string;
  item?: string;
  scopeItem?: string;
  llmError?: string;
  page?: string;
  q?: string;
  podcastError?: string;
  podcastUrl?: string;
  pdfError?: string;
  password?: string;
  opmlError?: string;
  opmlFailed?: string;
  opmlImported?: string;
  rssError?: string;
  read?: string;
  rssPreview?: string;
  refetched?: string;
  settings?: string;
  settingsTab?: string;
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
type ChatThreads = Awaited<ReturnType<typeof getChatThreads>>;
type DigestItem = Awaited<ReturnType<typeof getRecentDigestItems>>[number];

const EMPTY_INBOX_PAGE: InboxPage = {
  items: [],
  page: 1,
  pageCount: 1,
  pageSize: 20,
  failedCount: 0,
  total: 0
};


function normalizeReadingFont(value: string | undefined): ReadingStyleInitialState["font"] {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | undefined): ReadingStyleInitialState["colorMode"] {
  return value === "dark" ? "dark" : "bright";
}

function normalizeReadingWidth(value: string | undefined): ReadingStyleInitialState["width"] {
  if (value === "narrow" || value === "wide") return value;
  return "medium";
}

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
type AddSourceTab = "url" | "pdf" | "rss";
function digestSummary(document: DigestItem["document"] | null | undefined, copy: UiCopy) {
  const summary = readLlmSummaryFromMetadata(document?.metadataJson);
  return summary ?? { language: null, overview: summarize(document?.text, copy), points: [] };
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
  return value === "url" || value === "pdf" || value === "rss" ? value : "url";
}


function libraryEntryContext(
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>,
  copy: UiCopy
): ReaderEntryContext {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const activeSourceKind = activeSource?.type === "rss"
    ? "feed"
    : activeSource?.type === "podcast" || activeSource?.type === "newsletter"
      ? activeSource.type
      : undefined;
  const label = filter.query
    ? copy.common.searchResults
    : filter.archived
      ? copy.nav.archive
      : filter.recentPosts
        ? copy.sidebar.recentPosts
        : filter.sourceType === "newsletter" && !filter.sourceId
          ? copy.sidebar.newsletters
          : filter.sourceType === "podcast" && !filter.sourceId
            ? copy.sidebar.podcasts
      : filter.status === "ready"
        ? copy.common.indexed
        : activeSource?.name ?? copy.nav.library;

  return {
    label,
    query: {
      q: filter.query,
      filter: filter.archived
        ? "archive"
        : filter.recentPosts
          ? "recent-posts"
          : filter.sourceType === "newsletter" && !filter.sourceId
            ? "newsletters"
            : filter.sourceType === "podcast" && !filter.sourceId
              ? "podcasts"
              : undefined,
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

  const { citations } = parseChatMessageEvidence(assistant.citationsJson);

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
  pagination: Pick<InboxPage, "page" | "pageCount" | "pageSize" | "total" | "failedCount">;
  opmlImported?: string;
  opmlFailed?: string;
}) {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const isFeedPage = activeSource?.type === "rss";
  const isNewsletterStream = activeSource?.type === "newsletter" || filter.sourceType === "newsletter";
  const isPodcastStream = activeSource?.type === "podcast" || filter.sourceType === "podcast";
  const isSourceStream = filter.recentPosts || isFeedPage || isNewsletterStream || isPodcastStream;
  const isArchive = Boolean(filter.archived);
  const importingFeedCount = sources.filter((source) => source.type === "rss" && source.status === "importing").length;
  const entryContext = libraryEntryContext({ ...filter, page: pagination.page }, sources, copy);
  const filterRoute = {
    filter: filter.archived
      ? "archive"
      : filter.recentPosts
        ? "recent-posts"
        : filter.sourceType === "newsletter" && !filter.sourceId
          ? "newsletters"
          : filter.sourceType === "podcast" && !filter.sourceId
            ? "podcasts"
            : undefined,
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
      : isNewsletterStream && !activeSource
        ? copy.sidebar.newsletters
      : isPodcastStream && !activeSource
        ? copy.sidebar.podcasts
      : filter.status === "ready"
        ? copy.common.indexed
        : filter.status === "failed"
          ? copy.common.failed
        : activeSource?.name ?? copy.nav.library;
  const headingCopy = isArchive
    ? copy.library.archiveCopy
    : filter.recentPosts
      ? copy.library.feedCopy
    : isNewsletterStream
      ? copy.library.newsletterCopy
    : isPodcastStream
      ? copy.library.podcastCopy
    : null;
  const emptyStateCopy = filter.query || filter.status
    ? (locale === "zh-Hans" ? "没有符合当前筛选的文章。" : "No articles match these filters.")
    : isArchive
    ? copy.library.emptyArchive
    : filter.recentPosts || isFeedPage
      ? copy.library.emptyFeeds
      : isNewsletterStream
        ? copy.library.emptyNewsletters
        : isPodcastStream
          ? copy.library.emptyPodcasts
          : copy.library.emptyLibrary;

  return (
    <div className="libraryView">
      <LibraryScrollRestorer key={JSON.stringify(filter)} />
      <div className="libraryHeading">
        <div>
          <h1>{heading}</h1>
          {headingCopy ? <p>{headingCopy}</p> : null}
        </div>
        <div className="libraryHeadingActions">
          <span>{copy.library.totalCount(pagination.total)}</span>
          {isFeedPage ? (
            <>
              <FeedAutoSaveToggle
                enabled={activeSource.autoSaveToLibrary}
                label={copy.library.autoSaveFeed}
                locale={locale}
                sourceId={activeSource.id}
              />
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
            </>
          ) : null}
          {activeSource?.type === "newsletter" ? (
            <NewsletterSourceActions locale={locale} name={activeSource.name} sourceId={activeSource.id} />
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

      {isFeedPage && activeSource.status === "error" ? (
        <div className="sourceHealthNotice">
          <strong>{copy.sidebar.feedError}</strong>
          <span>{copy.library.feedSourceError}</span>
        </div>
      ) : null}

      {!isSourceStream ? (
        <>
          <form action={searchAction} className="searchShell">
            {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}
            <span>⌕</span>
            <input name="q" placeholder={copy.library.searchPlaceholder} defaultValue={filter.query ?? ""} />
          </form>

          {pagination.failedCount > 0 || filter.status || filter.query ? <div className="chips">
            <Link className={!filter.status ? "active" : ""} href={buildHref({ ...filterRoute, status: undefined, q: filter.query ?? undefined })}>{copy.common.all}</Link>
            {pagination.failedCount > 0 || filter.status === "failed" ? <Link className={filter.status === "failed" ? "active" : ""} href={buildHref({ ...filterRoute, status: "failed", q: filter.query ?? undefined })}>{copy.common.failed} · {pagination.failedCount}</Link> : null}
            {filter.query ? <Link href={searchAction}>{copy.common.clearSearch}</Link> : null}
          </div> : null}
        </>
      ) : null}

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>{emptyStateCopy}</h2>
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

function BriefingView({ brief, copy, digestItems, thread, newToday }: { newToday: number; brief: Brief; copy: UiCopy; digestItems: DigestItem[]; thread: ChatThread }) {
  const zh = copy.locale === "zh-Hans";
  const entryContext: ReaderEntryContext = { label: copy.nav.briefing, query: { view: "brief" } };
  const unfinished = digestItems.filter(item => item.readingProgress > 0.02 && item.readingProgress < 0.98)
    .sort((a, b) => (b.lastReadAt?.getTime() ?? 0) - (a.lastReadAt?.getTime() ?? 0))[0];
  const candidates = digestItems.filter(item => item.id !== unfinished?.id && item.readingProgress < 0.98);
  const picks = candidates.slice(0, 3);
  const remaining = candidates.slice(3);
  return <article className="briefingView">
    <div className="briefingMeta"><span>{formatDate(brief.date, copy.locale, copy.common.noDate)}</span><strong>{zh ? "来自你的资料库" : "From your library"}</strong></div>
    <h1>{zh ? "今天读点什么？" : "What will you read today?"}</h1>
    <p className="briefingLead">{newToday ? (zh ? "从最近保存的内容开始。" : "Start with your recent saves.") : (zh ? "从之前保存的文章中挑一篇。" : "Revisit something from your reading list.")}</p>
    {unfinished ? <section className="briefingResume">
      <span className="tag">{zh ? "接着上次读" : "Pick up where you left off"}</span>
      <Link href={readerItemRoute(unfinished.id, entryContext)}><h2>{unfinished.title}</h2></Link>
      <p>{zh ? `已读 ${Math.round(unfinished.readingProgress * 100)}%` : `${Math.round(unfinished.readingProgress * 100)}% read`} · {formatReadTime(Math.max(1, Math.ceil((readingMinutes(unfinished.document?.text) ?? 1) * (1 - unfinished.readingProgress))), copy.locale)} {zh ? "剩余" : "left"}</p>
    </section> : null}
    <section className="briefingDigest">
      <div className="sectionHeading"><h2>{zh ? "值得打开" : "Worth opening"}</h2></div>
      <div className="digestList">
        {picks.length === 0 ? <p>{zh ? "这里的文章都读完了，去资料库挑选下一篇吧。" : "You’re caught up with these articles. Choose another from your library."} <Link href="/home">{copy.nav.library} →</Link></p> : picks.map(item => (
          <Link href={readerItemRoute(item.id, entryContext)} className="digestItem" key={item.id}>
            <div><span className="tag">{itemKindLabel(item, copy)}</span><strong>{hostnameFor(item)}</strong><em>{estimateRead(item.document?.text, copy.locale)}</em></div>
            <h2>{item.title}</h2>
            <p>{digestSummary(item.document, copy).overview}</p>
          </Link>
        ))}
      </div>
    </section>
    {remaining.length ? <details className="briefingMore"><summary>{zh ? `还有 ${remaining.length} 篇待读` : `${remaining.length} more to read`}</summary>{remaining.map(item => <p key={item.id}><Link href={readerItemRoute(item.id, entryContext)}>{item.title}</Link> · {estimateRead(item.document?.text, copy.locale)}</p>)}</details> : null}
    <section className="askStrip" id="ask">
      <div className="sectionHeading"><h2>{copy.ask.continueFromBriefing}</h2></div>
      <form action={askLibraryAction} className="askForm">
        <input type="hidden" name="returnView" value="brief" />
        {thread ? <input type="hidden" name="threadId" value={thread.id} /> : null}
        <input name="question" placeholder={copy.ask.followUpPlaceholder} required />
        <button type="submit">{copy.ask.ask}</button>
      </form>
      <AssistantAnswer copy={copy} entryContext={entryContext} thread={thread} />
    </section>
  </article>;
}

function formatChatTime(value: Date, locale: SystemLanguage) {
  const elapsedMs = value.getTime() - Date.now();
  const elapsedHours = Math.round(elapsedMs / 3_600_000);
  const language = locale === "zh-Hans" ? "zh-CN" : "en";
  const relative = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });

  if (Math.abs(elapsedHours) < 24) return relative.format(elapsedHours, "hour");
  const elapsedDays = Math.round(elapsedMs / 86_400_000);
  if (Math.abs(elapsedDays) < 7) return relative.format(elapsedDays, "day");
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(value);
}

function AskView({ copy, locale, thread, threads, scopedItem }: { copy: UiCopy; locale: SystemLanguage; thread: ChatThread; threads: ChatThreads; scopedItem: Awaited<ReturnType<typeof getItemForReader>> }) {
  const entryContext: ReaderEntryContext = {
    label: copy.nav.ask,
    query: { view: "ask", thread: thread?.id }
  };
  const suggestions = scopedItem ? (locale === "zh-Hans" ? ["这篇文章的核心观点是什么？", "哪些论据支持作者的结论？"] : ["What is the main argument of this article?", "What evidence supports the conclusion?"]) : copy.ask.suggestions;
  const latestMessageId = thread?.messages[thread.messages.length - 1]?.id ?? null;

  return (
    <div className="askWorkspace">
      <input className="askHistoryToggle" id="ask-history-toggle" type="checkbox" />
      <aside className="askHistory" aria-label={copy.ask.history}>
        <header>
          <h2>{copy.ask.history}</h2>
          <label aria-label={copy.ask.closeHistory} className="askHistoryClose" htmlFor="ask-history-toggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </label>
        </header>
        <Link className="askNewChat" href="/ask">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {copy.ask.newChat}
        </Link>
        <nav>
          {threads.length === 0 ? <p>{copy.ask.noHistory}</p> : threads.map((historyThread) => (
            <div className={historyThread.id === thread?.id ? "active" : ""} key={historyThread.id}>
              <Link href={buildHref({ view: "ask", thread: historyThread.id })}>
                <strong>{historyThread.title}</strong>
                <small>{formatChatTime(historyThread.messages[0]?.createdAt ?? historyThread.createdAt, locale)}</small>
              </Link>
              <DeleteChatThreadButton
                className="askHistoryDelete"
                locale={locale}
                threadId={historyThread.id}
                threadTitle={historyThread.title}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DeleteChatThreadButton>
            </div>
          ))}
        </nav>
      </aside>

      <label aria-hidden="true" className="askHistoryScrim" htmlFor="ask-history-toggle" />

      <article className="askView">
        <div className={`askConversation ${!thread ? "isEmpty" : ""}`}>
          <header>
            <label aria-label={copy.ask.history} className="askHistoryOpen" htmlFor="ask-history-toggle">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </label>
            <div>
              <h1>{scopedItem ? (locale === "zh-Hans" ? "询问这篇文章" : "Ask about this article") : copy.ask.title}</h1>
              {scopedItem ? <p>{scopedItem.title}</p> : null}
            </div>
          </header>

          <div className="askMessages">
        {thread ? (
          thread.messages.map((message) => {
            const evidence = parseChatMessageEvidence(message.citationsJson);
            return (
              <div className={`askMessage ${message.role === "user" ? "isUser" : "isAssistant"}`} key={message.id}>
                {message.role === "assistant" ? <span className="askAvatar"><i /></span> : null}
                <div>
                  {evidence.activity.length > 0 || evidence.agent ? (
                    <details className="askActivity">
                      <summary>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                        {copy.ask.activity(evidence.activity.length + (evidence.agent ? 1 : 0))}
                      </summary>
                      <ol>
                        {evidence.activity.map((entry, index) => (
                          <li key={`${message.id}-${entry.tool}-${index}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                            <span><strong>{entry.label}</strong><small>{entry.detail} · {copy.ask.results(entry.resultCount)}</small></span>
                          </li>
                        ))}
                        {evidence.agent ? (
                          <li>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                            <span>
                              <strong>{copy.ask.synthesis}</strong>
                              <small>{evidence.agent.mode === "model" ? evidence.agent.model ?? copy.ask.unknownModel : copy.ask.fallbackUsed}</small>
                            </span>
                          </li>
                        ) : null}
                      </ol>
                    </details>
                  ) : null}
                  <p>{message.content}</p>
                  {evidence.agent?.mode === "fallback" ? (
                    <div className="askAgentStatus isFallback">
                      <i />
                      <span>{copy.ask.fallbackUsed}</span>
                      {evidence.agent.reason ? (
                        <small>{copy.ask.fallbackReason[evidence.agent.reason]}</small>
                      ) : null}
                    </div>
                  ) : null}
                  {evidence.citations.length > 0 ? (
                    <div className="askCitations">
                      <strong>{copy.ask.sources}</strong>
                      {evidence.citations.map((citation, index) => (
                        <Link href={readerItemRoute(citation.itemId, entryContext)} key={`${message.id}-${citation.itemId}-${index}`}>
                          <span>{citation.source}</span>
                          {citation.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <AskMessageActions copiedLabel={copy.ask.copied} copyLabel={copy.ask.copyMessage} text={message.content} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="askEmpty">
            <span className="askAvatar"><i /></span>
            <p>{scopedItem ? (locale === "zh-Hans" ? "围绕这篇文章提问，回答会附上可查看的原文依据。" : "Ask about this article. Answers include passages you can inspect in the original.") : (locale === "zh-Hans" ? "向已保存的内容提问，回答附有原文依据。" : "Ask your saved library. Answers link back to the sources.")}</p>
          </div>
        )}
          <AskScrollAnchor messageId={latestMessageId} />
          </div>

          <div className="askComposer">
        {!thread ? (
          <div className="askSuggestions">
            {suggestions.map((suggestion) => (
              <form action={askLibraryAction} key={suggestion}>
                <input type="hidden" name="question" value={suggestion} />
                <input type="hidden" name="returnView" value="ask" />
                {scopedItem ? <input type="hidden" name="itemId" value={scopedItem.id} /> : null}
                <button type="submit">{suggestion}</button>
              </form>
            ))}
          </div>
        ) : null}
          <p className="askScope">{scopedItem ? (locale === "zh-Hans" ? `仅询问：${scopedItem.title}` : `This article only: ${scopedItem.title}`) : (locale === "zh-Hans" ? "已保存内容 · 含归档" : "Saved items · includes archive")}</p>
          <AskComposer
            itemId={scopedItem?.id}
            pendingLabel={copy.ask.thinking}
            placeholder={copy.ask.placeholder}
            progressLabels={copy.ask.progress}
            sendLabel={copy.ask.ask}
            threadId={thread?.id}
          />
          </div>
        </div>
      </article>
    </div>
  );
}

export async function CurioflowHome({ searchParams, routeParams = {} }: CurioflowHomeProps) {
  const queryParams = (await searchParams) ?? {};
  const params = { ...routeParams, ...queryParams };
  const requestedView: AppView =
    params?.view === "brief" || params?.view === "digest"
      ? "brief"
      : params?.view === "ask"
          ? "ask"
          : "library";
  const activeAddTab = addSourceTab(params?.add, Boolean(params?.rssPreview));
  const archivedFilter = params?.filter === "archive" || params?.view === "archive";
  const recentPostsFilter = params?.filter === "recent-posts";
  const newslettersFilter = params?.filter === "newsletters";
  const podcastsFilter = params?.filter === "podcasts";
  const libraryFilterParam = archivedFilter ? "archive" : recentPostsFilter ? "recent-posts" : newslettersFilter ? "newsletters" : podcastsFilter ? "podcasts" : undefined;
  const currentPage = pageFilter(params?.page);
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    sourceType: recentPostsFilter ? "rss" : newslettersFilter ? "newsletter" : podcastsFilter ? "podcast" : undefined,
    status: itemStatusFilter(params?.status),
    archived: archivedFilter,
    recentPosts: recentPostsFilter,
    page: currentPage
  };
  const needsInbox = requestedView === "library" || Boolean(params?.item);
  const needsBriefing = requestedView === "brief";
  const needsThread = requestedView === "brief" || requestedView === "ask";
  const [user, library, initialInboxPage, readerItem, counts, sources, brief, thread, threads, llmSettings, digestItems, connections, todayReadableCount] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    needsInbox ? getInboxItems(filter, { page: currentPage, pageSize: 20 }) : Promise.resolve(EMPTY_INBOX_PAGE),
    getItemForReader(params?.item),
    getDashboardCounts(),
    getLibrarySources(),
    needsBriefing ? getOrCreateTodayBrief() : Promise.resolve(null),
    needsThread ? getChatThread(params?.thread) : Promise.resolve(null),
    requestedView === "ask" ? getChatThreads() : Promise.resolve([]),
    getLlmSettingsForCurrentAccount(),
    needsBriefing ? getRecentDigestItems() : Promise.resolve([]),
    getConnectionSettings(),
    needsBriefing ? getTodayReadableSaveCount() : Promise.resolve(0)
  ]);
  const scopedItemId = requestedView === "ask" ? (thread?.itemId ?? params?.scopeItem) : undefined;
  const scopedItem = scopedItemId ? await getItemForReader(scopedItemId) : null;
  if (scopedItemId && !scopedItem) notFound();
  const rssPreviewError: string | null = searchFilter(params?.rssError) ?? null;
  const rssPreviewUrl = searchFilter(params?.rssPreview);
  const podcastError: string | null = searchFilter(params?.podcastError) ?? null;
  const podcastUrl = searchFilter(params?.podcastUrl);
  const pdfError: string | null = searchFilter(params?.pdfError) ?? null;
  const opmlError: string | null = searchFilter(params?.opmlError) ?? null;

  const inboxPage = !llmSettings.enabled && !needsInbox
    ? await getInboxItems(filter, { page: currentPage, pageSize: 20 })
    : initialInboxPage;
  const items = inboxPage.items;
  const locale = normalizeSystemLanguage(llmSettings.systemLanguage);
  const copy = getUiCopy(locale);
  const view: AppView = llmSettings.enabled ? requestedView : "library";
  const effectiveParams = llmSettings.enabled ? params : { ...params, view: undefined, thread: undefined };
  const backContext = readerEntryContext(effectiveParams, filter, sources, copy);
  const hasActiveJobs = counts.jobCounts.active > 0;
  const hasPendingReaderSummary = llmSettings.enabled && isSummaryGenerationPending(readerItem?.document?.metadataJson);
  const baseQuery = {
    item: params?.item,
    q: params?.q,
    filter: libraryFilterParam,
    refetched: params?.refetched,
    source: params?.source,
    sourceKind: params?.sourceKind,
    status: params?.status,
    summary: params?.summary,
    thread: effectiveParams.thread,
    view: effectiveParams.view && effectiveParams.view !== "settings" && effectiveParams.view !== "archive" ? effectiveParams.view : undefined
  };
  const settingsCloseHref = buildHref(baseQuery);
  const settingsHref = buildHref({ ...baseQuery, settings: "1" }) as Route;
  const settingsOpen = Boolean(params?.settings) || params?.view === "settings";
  const cookieStore = await cookies();
  const readingStyle: ReadingStyleInitialState = {
    font: normalizeReadingFont(cookieStore.get("curioflow-reading-font")?.value),
    colorMode: normalizeColorMode(cookieStore.get("curioflow-color-mode")?.value),
    width: normalizeReadingWidth(cookieStore.get("curioflow-reading-width")?.value)
  };
  const mobileShellLabel = readerItem
    ? backContext.label
    : view === "brief"
      ? copy.nav.briefing
      : view === "ask"
        ? copy.nav.ask
        : libraryEntryContext(filter, sources, copy).label;

  return (
    <MobileAppShell
      addSourceLabel={copy.nav.addSource}
      label={mobileShellLabel}
      sidebar={<Sidebar copy={copy} locale={locale} sources={sources} activeItemId={readerItem?.id} filter={filter} llmEnabled={llmSettings.enabled} settingsHref={settingsHref} view={view} userName={user.displayName} />}
    >
      <a className="skipToContent" href="#main-content">{copy.common.skipToContent}</a>
      <JobStatusRefresh active={hasActiveJobs || hasPendingReaderSummary} />

      <section className="mainShell" id="main-content" tabIndex={-1} aria-label={library.name}>
        <NavigationFeedback label={locale === "zh-Hans" ? "正在加载页面" : "Loading page"} />
        <JobStatusStrip jobCounts={counts.jobCounts} jobs={counts.jobs} locale={locale} sourceRollups={counts.sourceJobRollups} sources={sources} />
        <div className={`scrollArea ${view === "ask" && !readerItem ? "askScrollArea" : ""}`}>
          {readerItem ? (
            <ReaderView backContext={backContext} copy={copy} item={readerItem} items={items} llmEnabled={llmSettings.enabled} locale={locale} refetched={params?.refetched} summaryStatus={params?.summary} />
          ) : view === "brief" && brief ? (
            <BriefingView newToday={todayReadableCount} brief={brief} copy={copy} digestItems={digestItems} thread={thread} />
          ) : view === "ask" ? (
            <AskView scopedItem={scopedItem} copy={copy} locale={locale} thread={thread} threads={threads} />
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
        initialOpen={Boolean(params?.rssPreview || params?.add === "rss" || params?.add === "url" || params?.add === "pdf")}
        initialTab={activeAddTab}
        locale={locale}
        pdfError={pdfError}
        rssPreviewError={rssPreviewError}
        rssPreviewUrl={rssPreviewUrl}
        saveUrlAction={saveUrlAction}
        subscribeRssAction={addRssSourceAction}
        uploadPdfAction={uploadPdfAction}
      />
      <SettingsDialog
        addPodcastAction={addPodcastSourceAction}
        closeHref={settingsCloseHref}
        connections={connections}
        initialOpen={settingsOpen}
        initialTab={params?.settings === "import"
          ? "import"
          : params?.settingsTab === "language" || params?.settingsTab === "model" || params?.settingsTab === "tasks"
            ? params.settingsTab
            : "style"}
        importOpmlAction={importOpmlSourcesAction}
        locale={locale}
        llmSettings={llmSettings}
        llmError={params?.llmError}
        opmlError={opmlError}
        passwordStatus={params?.password}
        podcastError={podcastError}
        podcastUrl={podcastUrl}
        readingStyle={readingStyle}
        returnTo={settingsCloseHref}
        saved={params?.saved}
        userName={user.displayName}
      />
    </MobileAppShell>
  );
}
