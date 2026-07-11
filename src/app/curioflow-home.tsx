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
import { getRecentDigestItems } from "@/server/digest";
import { getSummaryRegenerationCandidateCount } from "@/server/summaries";
import { displayLanguageForSummary, readLlmSummaryFromMetadata, type SummaryDisplayLanguage } from "@/server/summary-metadata";
import { DeleteChatThreadButton, UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { FeedItemCard, PaginationControls } from "@/app/feed-item-card";
import { JobStatusRefresh } from "@/app/job-status-refresh";
import { JobStatusStrip } from "@/app/job-status-strip";
import { ReaderView } from "@/app/reader-view";
import {
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
import { AskScrollAnchor } from "@/app/ask-scroll-anchor";
import { getUiCopy, normalizeSystemLanguage, type SystemLanguage, type UiCopy } from "@/app/i18n";
import type { ReadingStyleInitialState } from "@/app/reading-style-settings";

export type PageSearchParams = {
  add?: string;
  filter?: string;
  item?: string;
  page?: string;
  q?: string;
  podcastError?: string;
  podcastUrl?: string;
  pdfError?: string;
  opmlError?: string;
  opmlFailed?: string;
  opmlImported?: string;
  rssError?: string;
  read?: string;
  rssPreview?: string;
  refetched?: string;
  settings?: string;
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

const APP_HOME = "/home" as Route;

function normalizeReadingFont(value: string | undefined): ReadingStyleInitialState["font"] {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | undefined): ReadingStyleInitialState["colorMode"] {
  return value === "dark" ? "dark" : "bright";
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
type AddSourceTab = "url" | "pdf" | "rss" | "opml" | "podcast";
type BriefSection = {
  title: string;
  summary: string;
  points?: string[];
  citations?: Array<{ itemId: string; source: string; title: string }>;
};
function digestSummary(document: DigestItem["document"] | null | undefined, copy: UiCopy) {
  const summary = readLlmSummaryFromMetadata(document?.metadataJson);
  return summary ?? { language: null, overview: summarize(document?.text, copy), points: [] };
}

function briefingLanguageForDigestItems(digestItems: DigestItem[]): SummaryDisplayLanguage {
  const counts = digestItems.reduce(
    (total, item) => {
      const language = displayLanguageForSummary(readLlmSummaryFromMetadata(item.document?.metadataJson));
      if (language) total[language] += 1;
      return total;
    },
    { en: 0, "zh-Hans": 0 }
  );

  return counts["zh-Hans"] > counts.en ? "zh-Hans" : "en";
}

function parseBriefSections(brief: Brief) {
  try {
    return JSON.parse(brief.sectionsJson) as BriefSection[];
  } catch {
    return [];
  }
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
  return value === "podcast" || value === "url" || value === "pdf" || value === "opml" || value === "rss" ? value : "url";
}

function isUnfiltered(filter: LibraryFilter) {
  return !filter.query && !filter.sourceId && !filter.sourceType && !filter.status && !filter.archived && !filter.recentPosts;
}

function libraryEntryContext(
  filter: LibraryFilter,
  sources: Awaited<ReturnType<typeof getLibrarySources>>,
  copy: UiCopy
): ReaderEntryContext {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const activeSourceKind = activeSource?.type === "rss" ? "feed" : activeSource?.type === "podcast" ? "podcast" : undefined;
  const label = filter.query
    ? copy.common.searchResults
    : filter.archived
      ? copy.nav.archive
      : filter.recentPosts
        ? copy.sidebar.recentPosts
      : filter.status === "ready"
        ? copy.common.indexed
        : activeSource?.name ?? copy.nav.library;

  return {
    label,
    query: {
      q: filter.query,
      filter: filter.archived ? "archive" : filter.recentPosts ? "recent-posts" : undefined,
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
  pagination: Pick<InboxPage, "page" | "pageCount" | "pageSize" | "total">;
  opmlImported?: string;
  opmlFailed?: string;
}) {
  const activeSource = sources.find((source) => source.id === filter.sourceId);
  const isFeedPage = activeSource?.type === "rss";
  const isRssAtomStream = filter.recentPosts || isFeedPage;
  const isArchive = Boolean(filter.archived);
  const importingFeedCount = sources.filter((source) => source.type === "rss" && source.status === "importing").length;
  const entryContext = libraryEntryContext({ ...filter, page: pagination.page }, sources, copy);
  const filterRoute = {
    filter: filter.archived ? "archive" : filter.recentPosts ? "recent-posts" : undefined,
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
      : filter.status === "ready"
        ? copy.common.indexed
        : filter.status === "failed"
          ? copy.common.failed
        : activeSource?.name ?? copy.nav.library;
  const headingCopy = isArchive
    ? copy.library.archiveCopy
    : filter.recentPosts
      ? copy.library.feedCopy
    : copy.library.libraryCopy;

  return (
    <div className="libraryView">
      <div className="libraryHeading">
        <div>
          <h1>{heading}</h1>
          <p>{headingCopy}</p>
        </div>
        <div className="libraryHeadingActions">
          <span>{copy.library.shownTotal(items.length, pagination.total)}</span>
          {isFeedPage ? (
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

      {!isRssAtomStream ? (
        <>
          <form action={searchAction} className="searchShell">
            <span>⌕</span>
            <input name="q" placeholder={copy.library.searchPlaceholder} defaultValue={filter.query ?? ""} />
          </form>

          <div className="chips">
            <Link className={isUnfiltered(filter) ? "active" : ""} href={APP_HOME}>{copy.common.all}</Link>
            <Link className={filter.status === "failed" ? "active" : ""} href="/status/failed">{copy.common.failed}</Link>
            {filter.query ? <Link href={searchAction}>{copy.common.clearSearch}</Link> : null}
            <span>{copy.library.rssFeeds}</span>
            <span>{copy.library.podcast}</span>
          </div>
        </>
      ) : null}

      <div className="feedList">
        {items.length === 0 ? (
          <div className="emptyState">
            <h2>{isArchive ? copy.library.emptyArchive : copy.library.emptyLibrary}</h2>
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

function BriefingView({
  brief,
  copy,
  counts,
  digestItems,
  thread
}: {
  brief: Brief;
  copy: UiCopy;
  counts: Awaited<ReturnType<typeof getDashboardCounts>>;
  digestItems: DigestItem[];
  thread: ChatThread;
}) {
  const sections = parseBriefSections(brief);
  const briefLanguage = briefingLanguageForDigestItems(digestItems);
  const briefingCopy = getUiCopy(briefLanguage);
  const entryContext: ReaderEntryContext = { label: copy.nav.briefing, query: { view: "brief" } };

  return (
    <article className="briefingView">
      <div className="briefingMeta">
        <span>{formatDate(brief.date, briefLanguage, briefingCopy.common.noDate)}</span>
        <strong><i />{briefingCopy.briefing.newSinceLast(counts.unread)}</strong>
      </div>

      <h1>{briefingCopy.briefing.greeting}<br />{briefingCopy.briefing.subtitle}</h1>
      <p className="briefingLead">{brief.summary}</p>

      <div className="briefingSections">
        {sections.map((section, index) => (
          <section key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            {section.points && section.points.length > 0 ? (
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
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

      <section className="briefingDigest">
        <div className="sectionHeading">
          <h2>{briefingCopy.briefing.digestTitle}</h2>
          <span>{briefingCopy.briefing.recent(digestItems.length)}</span>
        </div>
        <div className="digestList">
          {digestItems.length === 0 ? (
            <div className="emptyState">
              <h2>{copy.briefing.empty}</h2>
            </div>
          ) : (
            digestItems.map((item) => {
              const summary = digestSummary(item.document, copy);

              return (
                <Link href={readerItemRoute(item.id, entryContext)} className="digestItem" key={item.id}>
                  <div>
                    <span className="tag">{itemKindLabel(item, briefingCopy)}</span>
                    <strong>{item.source?.type === "rss" ? item.source.name : hostnameFor(item)}</strong>
                    <em>{formatDate(item.publishedAt ?? item.createdAt, briefLanguage, briefingCopy.common.noDate)}</em>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{summary.overview}</p>
                  {summary.points.length > 0 ? (
                    <ul>
                      {summary.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="askStrip" id="ask">
        <div className="sectionHeading">
          <h2>{briefingCopy.ask.continueFromBriefing}</h2>
          <span>{briefingCopy.ask.localPlaceholder}</span>
        </div>
        <p>{briefingCopy.ask.briefingDescription}</p>
        <form action={askLibraryAction} className="askForm">
          {thread ? <input type="hidden" name="threadId" value={thread.id} /> : null}
          <input name="question" placeholder={briefingCopy.ask.followUpPlaceholder} required />
          <button type="submit">{briefingCopy.ask.ask}</button>
        </form>
        <AssistantAnswer copy={copy} entryContext={entryContext} thread={thread} />
      </section>
    </article>
  );
}

function AskView({ copy, locale, thread, threads }: { copy: UiCopy; locale: SystemLanguage; thread: ChatThread; threads: ChatThreads }) {
  const entryContext: ReaderEntryContext = {
    label: copy.nav.ask,
    query: { view: "ask", thread: thread?.id }
  };
  const suggestions = copy.ask.suggestions;
  const latestMessageId = thread?.messages[thread.messages.length - 1]?.id ?? null;

  return (
    <div className="askWorkspace">
      <aside className="askHistory" aria-label={copy.ask.history}>
        <header>
          <h2>{copy.ask.history}</h2>
          <Link href="/ask">{copy.ask.newChat}</Link>
        </header>
        <nav>
          {threads.length === 0 ? <p>{copy.ask.noHistory}</p> : threads.map((historyThread) => (
            <div className={historyThread.id === thread?.id ? "active" : ""} key={historyThread.id}>
              <Link href={buildHref({ view: "ask", thread: historyThread.id })}>
                <strong>{historyThread.title}</strong>
                <small>{copy.ask.messages(historyThread._count.messages)}</small>
              </Link>
              <DeleteChatThreadButton
                className="askHistoryDelete"
                locale={locale}
                threadId={historyThread.id}
                threadTitle={historyThread.title}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                </svg>
              </DeleteChatThreadButton>
            </div>
          ))}
        </nav>
      </aside>

      <article className="askView">
        <header>
          <h1>{copy.ask.title}</h1>
          <p>{copy.ask.subtitle}</p>
        </header>

        <div className="askMessages">
        {thread ? (
          thread.messages.map((message) => {
            const evidence = parseChatMessageEvidence(message.citationsJson);
            return (
              <div className={`askMessage ${message.role === "user" ? "isUser" : "isAssistant"}`} key={message.id}>
                {message.role === "assistant" ? <span className="askAvatar"><i /></span> : null}
                <div>
                  <p>{message.content}</p>
                  {evidence.agent ? (
                    <div className={`askAgentStatus ${evidence.agent.mode === "model" ? "isModel" : "isFallback"}`}>
                      <i />
                      <span>
                        {evidence.agent.mode === "model"
                          ? copy.ask.modelUsed(evidence.agent.model ?? copy.ask.unknownModel)
                          : copy.ask.fallbackUsed}
                      </span>
                      {evidence.agent.mode === "fallback" && evidence.agent.reason ? (
                        <small>{copy.ask.fallbackReason[evidence.agent.reason]}</small>
                      ) : null}
                    </div>
                  ) : null}
                  {evidence.activity.length > 0 ? (
                    <details className="askActivity">
                      <summary>{copy.ask.activity(evidence.activity.length)}</summary>
                      <ol>
                        {evidence.activity.map((entry, index) => (
                          <li key={`${message.id}-${entry.tool}-${index}`}>
                            <span>{entry.label}</span>
                            <small>{entry.detail} · {copy.ask.results(entry.resultCount)}</small>
                          </li>
                        ))}
                      </ol>
                    </details>
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
                </div>
              </div>
            );
          })
        ) : (
          <div className="askEmpty">
            <span className="askAvatar"><i /></span>
            <p>{copy.ask.empty}</p>
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
                <button type="submit">{suggestion}</button>
              </form>
            ))}
          </div>
        ) : null}
        <form action={askLibraryAction} className="askForm">
          <input type="hidden" name="returnView" value="ask" />
          {thread ? <input type="hidden" name="threadId" value={thread.id} /> : null}
          <input name="question" placeholder={copy.ask.placeholder} required />
          <button type="submit">{copy.ask.ask}</button>
        </form>
        </div>
      </article>
    </div>
  );
}

export async function CurioflowHome({ searchParams, routeParams = {} }: CurioflowHomeProps) {
  const queryParams = (await searchParams) ?? {};
  const params = { ...routeParams, ...queryParams };
  const view: AppView =
    params?.view === "brief" || params?.view === "digest"
      ? "brief"
      : params?.view === "ask"
          ? "ask"
          : "library";
  const activeAddTab = addSourceTab(params?.add, Boolean(params?.rssPreview));
  const archivedFilter = params?.filter === "archive" || params?.view === "archive";
  const recentPostsFilter = params?.filter === "recent-posts";
  const libraryFilterParam = archivedFilter ? "archive" : recentPostsFilter ? "recent-posts" : undefined;
  const currentPage = pageFilter(params?.page);
  const filter = {
    query: searchFilter(params?.q),
    sourceId: params?.source,
    sourceType: recentPostsFilter ? "rss" : undefined,
    status: itemStatusFilter(params?.status),
    archived: archivedFilter,
    recentPosts: recentPostsFilter,
    page: currentPage
  };
  const [user, library, inboxPage, readerItem, counts, sources, brief, thread, threads, llmSettings, digestItems, connections] = await Promise.all([
    getCurrentUser(),
    getCurrentLibrary(),
    getInboxItems(filter, { page: currentPage, pageSize: 20 }),
    getItemForReader(params?.item),
    getDashboardCounts(),
    getLibrarySources(),
    getOrCreateTodayBrief(),
    getChatThread(params?.thread),
    view === "ask" ? getChatThreads() : Promise.resolve([]),
    getLlmSettingsForCurrentAccount(),
    getRecentDigestItems(),
    getConnectionSettings()
  ]);
  const rssPreviewError: string | null = searchFilter(params?.rssError) ?? null;
  const rssPreviewUrl = searchFilter(params?.rssPreview);
  const podcastError: string | null = searchFilter(params?.podcastError) ?? null;
  const podcastUrl = searchFilter(params?.podcastUrl);
  const pdfError: string | null = searchFilter(params?.pdfError) ?? null;
  const opmlError: string | null = searchFilter(params?.opmlError) ?? null;

  const items = inboxPage.items;
  const locale = normalizeSystemLanguage(llmSettings.systemLanguage);
  const copy = getUiCopy(locale);
  const backContext = readerEntryContext(params, filter, sources, copy);
  const hasActiveJobs = counts.jobCounts.active > 0;
  const hasPendingReaderSummary = isSummaryGenerationPending(readerItem?.document?.metadataJson);
  const baseQuery = {
    item: params?.item,
    q: params?.q,
    filter: libraryFilterParam,
    refetched: params?.refetched,
    source: params?.source,
    sourceKind: params?.sourceKind,
    status: params?.status,
    summary: params?.summary,
    thread: params?.thread,
    view: params?.view && params.view !== "settings" && params.view !== "archive" ? params.view : undefined
  };
  const settingsCloseHref = buildHref(baseQuery);
  const settingsHref = buildHref({ ...baseQuery, settings: "1" }) as Route;
  const settingsOpen = params?.settings === "1" || params?.view === "settings";
  const summaryRegenerationCount = settingsOpen ? await getSummaryRegenerationCandidateCount(library.id) : 0;
  const cookieStore = await cookies();
  const readingStyle: ReadingStyleInitialState = {
    font: normalizeReadingFont(cookieStore.get("curioflow-reading-font")?.value),
    colorMode: normalizeColorMode(cookieStore.get("curioflow-color-mode")?.value)
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
      sidebar={<Sidebar copy={copy} locale={locale} sources={sources} activeItemId={readerItem?.id} filter={filter} settingsHref={settingsHref} view={view} userName={user.displayName} />}
    >
      <a className="skipToContent" href="#main-content">{copy.common.skipToContent}</a>
      <JobStatusRefresh active={hasActiveJobs || hasPendingReaderSummary} />

      <section className="mainShell" id="main-content" tabIndex={-1} aria-label={library.name}>
        <JobStatusStrip jobCounts={counts.jobCounts} jobs={counts.jobs} locale={locale} sourceRollups={counts.sourceJobRollups} sources={sources} />
        <div className="scrollArea">
          {readerItem ? (
            <ReaderView backContext={backContext} copy={copy} item={readerItem} items={items} locale={locale} refetched={params?.refetched} summaryStatus={params?.summary} />
          ) : view === "brief" ? (
            <BriefingView brief={brief} copy={copy} counts={counts} digestItems={digestItems} thread={thread} />
          ) : view === "ask" ? (
            <AskView copy={copy} locale={locale} thread={thread} threads={threads} />
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
        addPodcastAction={addPodcastSourceAction}
        importOpmlAction={importOpmlSourcesAction}
        initialOpen={Boolean(params?.add || params?.rssPreview)}
        initialTab={activeAddTab}
        locale={locale}
        opmlError={opmlError}
        pdfError={pdfError}
        podcastError={podcastError}
        podcastUrl={podcastUrl}
        rssPreviewError={rssPreviewError}
        rssPreviewUrl={rssPreviewUrl}
        saveUrlAction={saveUrlAction}
        subscribeRssAction={addRssSourceAction}
        uploadPdfAction={uploadPdfAction}
      />
      <SettingsDialog
        closeHref={settingsCloseHref}
        connections={connections}
        copy={copy}
        isOpen={settingsOpen}
        locale={locale}
        llmSettings={llmSettings}
        readingStyle={readingStyle}
        returnTo={settingsCloseHref}
        saved={params?.saved}
        summaryRegenerationCount={summaryRegenerationCount}
      />
    </MobileAppShell>
  );
}
