import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { BACKGROUND_JOB_TYPES, isFailedRssFetchSourceJob } from "@/server/background-job-state";
import { dashboardJobCountsFromJobs, latestFailedSummaryJobsByArticle } from "@/server/dashboard-jobs";
import { itemListVisibilityMode, savedToLibraryFilterForVisibility, SOURCE_TYPE } from "@/server/item-state";
import { sourceJobRollupsFromJobs } from "@/server/job-source-rollups";
import { JOB_STATUS } from "@/server/job-state";
import { startQueuedBackgroundJobs } from "@/server/background-jobs";
import { compareItemsByFeedTime, compareItemsByRecentActivity } from "@/server/item-order";
import { failedArticleSummaryIds } from "@/server/summary-failure-state";

type InboxFilter = {
  query?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  status?: string | null;
  archived?: boolean | null;
};

const INBOX_DOCUMENT_PREVIEW_CHARS = 900;
const DEFAULT_INBOX_PAGE_SIZE = 20;
const MAX_INBOX_PAGE_SIZE = 50;
const DASHBOARD_SOURCE_ROLLUP_JOB_LIMIT = 500;

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
  const library = await getCurrentLibrary();
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
  const isChronologicalStream = !filter.archived
    && (
      activeSource?.type === SOURCE_TYPE.RSS
      || activeSource?.type === SOURCE_TYPE.NEWSLETTER
      || filter.sourceType === SOURCE_TYPE.RSS
      || filter.sourceType === SOURCE_TYPE.NEWSLETTER
    );
  const savedToLibraryFilter = savedToLibraryFilterForVisibility(visibilityMode);
  const savedVisibilityWhere = savedToLibraryFilter === null ? {} : { savedToLibrary: savedToLibraryFilter };
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
    ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...savedVisibilityWhere
  };
  const searchWhere = query
    ? {
        OR: [
          { title: { contains: query } },
          { url: { contains: query } },
          { author: { contains: query } },
          { source: { is: { name: { contains: query } } } },
          { sourceEntries: { some: { source: { name: { contains: query } } } } },
          { document: { is: { title: { contains: query } } } },
          { document: { is: { text: { contains: query } } } }
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
    sourceEntries: { include: { source: true } }
  };

  const orderedItems = await prisma.item.findMany({
    where,
    select: { id: true, createdAt: true, lastReadAt: true, publishedAt: true }
  });
  orderedItems.sort(isChronologicalStream ? compareItemsByFeedTime : compareItemsByRecentActivity);
  const total = orderedItems.length;
  const pageCount = Math.max(1, Math.ceil(total / requested.pageSize));
  const page = Math.min(requested.page, pageCount);
  const skip = (page - 1) * requested.pageSize;
  const pageItemIds = orderedItems.slice(skip, skip + requested.pageSize).map((item) => item.id);
  const unorderedPageItems = await prisma.item.findMany({
    where: { ...where, id: { in: pageItemIds } },
    include,
  });
  const pageItemsById = new Map(unorderedPageItems.map((item) => [item.id, item]));
  const pageItems = pageItemIds.flatMap((id) => {
    const item = pageItemsById.get(id);
    return item ? [item] : [];
  });

  return {
    items: pageItems.map((item) => {
      const displaySource = activeSource
        ?? item.sourceEntries.find((entry) => !filter.sourceType || entry.source.type === filter.sourceType)?.source
        ?? item.source;
      return {
        ...item,
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

export async function getDashboardCounts() {
  const library = await getCurrentLibrary();
  const visibleLibraryItems = { libraryId: library.id, savedToLibrary: true, archivedAt: null, deletedAt: null };
  void startQueuedBackgroundJobs({ libraryId: library.id }).catch(() => undefined);
  const activeJobStatuses = [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING];
  const [total, unread, ready, archived, rssSources, actionableJobs] = await Promise.all([
    prisma.item.count({ where: visibleLibraryItems }),
    prisma.item.count({ where: { ...visibleLibraryItems, readingProgress: { lte: 0 } } }),
    prisma.item.count({ where: { ...visibleLibraryItems, status: "ready" } }),
    prisma.item.count({ where: { libraryId: library.id, archivedAt: { not: null }, deletedAt: null } }),
    prisma.source.findMany({
      where: {
        libraryId: library.id,
        type: "rss",
        status: { not: "unsubscribed" }
      },
      select: { id: true }
    }),
    prisma.job.findMany({
      where: {
        libraryId: library.id,
        OR: [
          { status: { in: activeJobStatuses } },
          { status: JOB_STATUS.FAILED, type: BACKGROUND_JOB_TYPES.GENERATE_SUMMARY }
        ]
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
    })
  ]);

  const rssSourceIds = new Set(rssSources.map((source) => source.id));
  const globallyVisibleJobs = actionableJobs.filter((job) => !isFailedRssFetchSourceJob(job, rssSourceIds));
  const failedSummaryJobs = globallyVisibleJobs
    .filter((job) => job.status === JOB_STATUS.FAILED)
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0) || b.createdAt.getTime() - a.createdAt.getTime());
  const failedSummaryItemIds = Array.from(new Set(failedSummaryJobs.flatMap((job) => {
    try {
      const payload = JSON.parse(job.payloadJson) as { itemId?: unknown };
      return typeof payload.itemId === "string" && payload.itemId.trim() ? [payload.itemId] : [];
    } catch {
      return [];
    }
  })));
  const failedSummaryItems = failedSummaryItemIds.length > 0
    ? await prisma.item.findMany({
        where: {
          id: { in: failedSummaryItemIds },
          libraryId: library.id,
          deletedAt: null,
          type: "article",
          document: {
            is: {
              OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }]
            }
          }
        },
        select: {
          id: true,
          type: true,
          document: {
            select: {
              metadataJson: true
            }
          }
        }
      })
    : [];
  const failedArticleIds = failedArticleSummaryIds(failedSummaryItems);
  const currentFailedSummaryJobs = latestFailedSummaryJobsByArticle(failedSummaryJobs, failedArticleIds);
  const allActiveJobs = globallyVisibleJobs
    .filter((job) => activeJobStatuses.includes(job.status as typeof activeJobStatuses[number]))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const failedJobs = currentFailedSummaryJobs.slice(0, 5);
  const activeJobs = allActiveJobs.slice(0, 5);
  const sourceRollupJobs = [...currentFailedSummaryJobs, ...allActiveJobs].slice(0, DASHBOARD_SOURCE_ROLLUP_JOB_LIMIT);
  const jobCounts = dashboardJobCountsFromJobs(globallyVisibleJobs, failedArticleIds.size);
  const sourceJobRollups = sourceJobRollupsFromJobs(sourceRollupJobs);

  return { total, unread, ready, archived, jobs: [...failedJobs, ...activeJobs], jobCounts, sourceJobRollups };
}
