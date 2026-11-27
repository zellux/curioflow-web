import { readingMinutes } from "@/server/reading-time";
import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { isFailedRssFetchSourceJob } from "@/server/background-job-state";
import { dashboardJobCountsFromJobs } from "@/server/dashboard-jobs";
import { archivedFilterForVisibility, itemListVisibilityMode, READING_COMPLETION_THRESHOLD, savedToLibraryFilterForVisibility } from "@/server/item-state";
import { sourceJobRollupsFromJobs } from "@/server/job-source-rollups";
import { JOB_STATUS } from "@/server/job-state";
import { getArticleIssues } from "@/server/article-issues";
import { translationSourceHash } from "@/server/translation-content";

type InboxFilter = {
  query?: string | null;
  read?: "unread" | "read" | null;
  sourceId?: string | null;
  sourceType?: string | null;
  status?: string | null;
  archived?: boolean | null;
  starred?: boolean;
};

const INBOX_DOCUMENT_PREVIEW_CHARS = 900;
const DEFAULT_INBOX_PAGE_SIZE = 20;
const MAX_INBOX_PAGE_SIZE = 50;
const DASHBOARD_SOURCE_ROLLUP_JOB_LIMIT = 500;

// SQLite LIKE ignores ASCII case, but PostgreSQL `contains` does not unless asked.
// The SQLite Prisma client rejects `mode`, so only add it for PostgreSQL.
const USES_POSTGRES = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "");

function textContains(query: string) {
  return (USES_POSTGRES ? { contains: query, mode: "insensitive" } : { contains: query }) as { contains: string };
}

type InboxPagination = {
  page?: number | null;
  pageSize?: number | null;
};

function normalizePagination(pagination: InboxPagination) {
  const page = Math.max(1, Math.floor(pagination.page ?? 1));
  const pageSize = Math.max(1, Math.min(MAX_INBOX_PAGE_SIZE, Math.floor(pagination.pageSize ?? DEFAULT_INBOX_PAGE_SIZE)));
  return { page, pageSize };
}

export async function getInboxItems(filter: InboxFilter = {}, pagination: InboxPagination = {}) {
  const [library, user] = await Promise.all([getCurrentLibrary(), getCurrentUser()]);
  const query = filter.query?.trim();
  const requested = normalizePagination(pagination);
  const activeSource = filter.sourceId
    ? await prisma.source.findFirst({
        where: { id: filter.sourceId, libraryId: library.id }
      })
    : null;
  const visibilityMode = itemListVisibilityMode({
    activeSourceType: activeSource?.type,
    archived: filter.archived,
    sourceType: filter.sourceType
  });
  const isChronologicalStream = visibilityMode === "source-stream" || filter.starred;
  const savedToLibraryFilter = savedToLibraryFilterForVisibility(visibilityMode);
  const archivedFilter = archivedFilterForVisibility(visibilityMode);
  const savedVisibilityWhere = savedToLibraryFilter === null ? {} : { savedToLibrary: savedToLibraryFilter };
  const archivedVisibilityWhere =
    archivedFilter === "archived"
      ? { archivedAt: { not: null } }
      : archivedFilter === "active"
        ? { archivedAt: null }
        : {};
  const baseWhere = {
    libraryId: library.id,
    deletedAt: null,
    OR: [
      { documentId: null },
      { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }
    ],
    ...(filter.sourceId ? { sourceEntries: { some: { sourceId: filter.sourceId } } } : {}),
    ...(filter.sourceType ? { sourceEntries: { some: { source: { type: filter.sourceType, status: { not: "unsubscribed" } } } } } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.read === "unread"
      ? { readingProgress: { lt: READING_COMPLETION_THRESHOLD } }
      : filter.read === "read"
        ? { readingProgress: { gte: READING_COMPLETION_THRESHOLD } }
        : {}),
    ...(filter.starred
      ? { starred: true }
      : { ...archivedVisibilityWhere, ...savedVisibilityWhere })
  };
  const searchWhere = query
    ? {
        OR: [
          { title: textContains(query) },
          { url: textContains(query) },
          { author: textContains(query) },
          { source: { is: { name: textContains(query) } } },
          { sourceEntries: { some: { source: { name: textContains(query) } } } },
          { document: { is: { title: textContains(query) } } },
          { document: { is: { text: textContains(query) } } }
        ]
      }
    : {};
  const where = query ? { AND: [baseWhere, searchWhere] } : baseWhere;
  const include = {
    document: {
      select: {
        id: true,
        contentObjectId: true,
        cachedFileId: true,
        contentType: true,
        title: true,
        text: true,
        contentHash: true,
        parserVersion: true,
        language: true,
        metadataJson: true,
        createdAt: true
      }
    },
    contentObject: true,
    source: true,
    sourceEntries: { include: { source: true } },
    translations: {
      where: { articleHtml: { not: null } },
      select: { language: true, sourceHash: true }
    },
    _count: {
      select: {
        annotations: {
          where: { userId: user.id }
        }
      }
    }
  };

  const [total, failedCount] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.count({ where: { AND: [{ ...baseWhere, status: "failed", readingProgress: undefined }, searchWhere] } })
  ]);
  const pageCount = Math.max(1, Math.ceil(total / requested.pageSize));
  const page = Math.min(requested.page, pageCount);
  const skip = (page - 1) * requested.pageSize;
  const pageItems = await prisma.item.findMany({
    where,
    include,
    orderBy: [
      isChronologicalStream ? { feedAt: "desc" } : { activityAt: "desc" },
      { createdAt: "desc" },
      { id: "asc" }
    ],
    skip,
    take: requested.pageSize
  });

  const translatedDocIds = [...new Set(
    pageItems
      .filter((item) => item.translations.length > 0 && item.documentId)
      .map((item) => item.documentId!)
  )];
  const fullDocsById = translatedDocIds.length > 0
    ? new Map(
        (await prisma.document.findMany({
          where: { id: { in: translatedDocIds } },
          select: { id: true, text: true, articleHtml: true }
        })).map((doc) => [doc.id, doc])
      )
    : new Map<string, { id: string; text: string; articleHtml: string | null }>();

  return {
    items: pageItems.map((item) => {
      const displaySource = activeSource
        ?? item.sourceEntries.find((entry) => !filter.sourceType || entry.source.type === filter.sourceType)?.source
        ?? item.source;
      const fullDoc = item.documentId ? fullDocsById.get(item.documentId) ?? null : null;
      const expectedSourceHash = fullDoc && item.translations.length > 0
        ? translationSourceHash({ title: item.title, document: fullDoc })
        : null;
      const readyTranslationLanguages = expectedSourceHash
        ? [...new Set(
            item.translations
              .filter((entry) => entry.sourceHash === expectedSourceHash)
              .map((entry) => entry.language)
          )]
        : [];
      return {
        ...item,
        annotationCount: item._count.annotations,
        readyTranslationLanguages,
        readingMinutes: readingMinutes(item.document?.text),
        sourceId: displaySource?.id ?? item.sourceId,
        source: displaySource,
        document: item.document
          ? {
              ...item.document,
              text: item.document.text.slice(0, INBOX_DOCUMENT_PREVIEW_CHARS)
            }
          : null
      };
    }),
    page,
    pageCount,
    pageSize: requested.pageSize,
    failedCount,
    total
  };
}

export async function getItemForReader(itemId?: string) {
  if (!itemId) return null;

  const library = await getCurrentLibrary();
  const user = await getCurrentUser();
  const readerInclude = {
    document: { include: { chunks: { orderBy: { chunkIndex: "asc" as const } } } },
    contentObject: true,
    source: true,
    sourceEntries: { include: { source: true } },
    annotations: {
      where: { userId: user.id },
      orderBy: { createdAt: "desc" as const }
    }
  };

  return prisma.item.findFirst({
    where: {
      id: itemId,
      libraryId: library.id,
      deletedAt: null,
      OR: [
        { documentId: null },
        { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }
      ]
    },
    include: readerInclude
  });
}

export async function getBackgroundWorkStatusForLibrary(libraryId: string) {
  const activeJobStatuses = [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING];
  const [rssSources, actionableJobs, articleIssues, latestFinishedJob] = await Promise.all([
    prisma.source.findMany({
      where: {
        libraryId,
        type: "rss",
        status: { not: "unsubscribed" }
      },
      select: { id: true }
    }),
    prisma.job.findMany({
      where: {
        libraryId,
        status: { in: activeJobStatuses }
      },
      select: {
        createdAt: true,
        error: true,
        finishedAt: true,
        id: true,
        payloadJson: true,
        progressJson: true,
        status: true,
        type: true
      },
      orderBy: { createdAt: "desc" },
    }),
    getArticleIssues(libraryId),
    prisma.job.findFirst({
      where: { libraryId, finishedAt: { not: null } },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      select: { id: true, finishedAt: true }
    })
  ]);

  const rssSourceIds = new Set(rssSources.map((source) => source.id));
  const globallyVisibleJobs = actionableJobs.filter((job) => !isFailedRssFetchSourceJob(job, rssSourceIds));
  const currentFailedSummaryJobs = articleIssues.flatMap(issue => issue.job ? [issue.job] : []);
  const allActiveJobs = globallyVisibleJobs
    .filter((job) => activeJobStatuses.includes(job.status as typeof activeJobStatuses[number]))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const failedJobs = currentFailedSummaryJobs.slice(0, 5);
  const activeJobs = allActiveJobs.slice(0, 5);
  const sourceRollupJobs = [...currentFailedSummaryJobs, ...allActiveJobs].slice(0, DASHBOARD_SOURCE_ROLLUP_JOB_LIMIT);
  const jobCounts = dashboardJobCountsFromJobs(globallyVisibleJobs, articleIssues.length);
  const sourceJobRollups = sourceJobRollupsFromJobs(sourceRollupJobs);

  return {
    jobs: [...failedJobs, ...activeJobs],
    jobCounts,
    sourceJobRollups,
    activeJobIds: allActiveJobs.map(job => job.id),
    completedWorkVersion: latestFinishedJob ? `${latestFinishedJob.id}:${latestFinishedJob.finishedAt!.toISOString()}` : null
  };
}


export async function getDashboardCounts() {
  const library = await getCurrentLibrary();
  const visibleLibraryItems = { libraryId: library.id, savedToLibrary: true, archivedAt: null, deletedAt: null };
  const [total, unread, ready, archived, background] = await Promise.all([
    prisma.item.count({ where: visibleLibraryItems }),
    prisma.item.count({ where: { ...visibleLibraryItems, readingProgress: { lte: 0 } } }),
    prisma.item.count({ where: { ...visibleLibraryItems, status: "ready" } }),
    prisma.item.count({ where: { libraryId: library.id, archivedAt: { not: null }, deletedAt: null } }),
    getBackgroundWorkStatusForLibrary(library.id)
  ]);
  const { jobs, jobCounts, sourceJobRollups } = background;
  return { total, unread, ready, archived, jobs, jobCounts, sourceJobRollups };
}
