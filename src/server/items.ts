import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { itemListVisibilityMode, savedToLibraryFilterForVisibility } from "@/server/item-state";
import { actionableJobStatuses } from "@/server/job-state";
import { startQueuedBackgroundJobs } from "@/server/background-jobs";

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
        where: { id: filter.sourceId, libraryId: library.id },
        select: { type: true }
      })
    : null;
  const visibilityMode = itemListVisibilityMode({
    activeSourceType: activeSource?.type,
    archived: filter.archived,
    sourceType: filter.sourceType
  });
  const savedToLibraryFilter = savedToLibraryFilterForVisibility(visibilityMode);
  const savedVisibilityWhere = savedToLibraryFilter === null ? {} : { savedToLibrary: savedToLibraryFilter };
  const baseWhere = {
    libraryId: library.id,
    ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    ...(filter.sourceType ? { source: { is: { type: filter.sourceType } } } : {}),
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
    source: true
  };

  const total = await prisma.item.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / requested.pageSize));
  const page = Math.min(requested.page, pageCount);
  const skip = (page - 1) * requested.pageSize;
  const pageItems = await prisma.item.findMany({
    where,
    include,
    orderBy: visibilityMode === "source-stream" ? [{ publishedAt: "desc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }],
    skip,
    take: requested.pageSize
  });

  return {
    items: pageItems.map((item) => ({
      ...item,
      document: item.document
        ? {
            ...item.document,
            text: item.document.text.slice(0, INBOX_DOCUMENT_PREVIEW_CHARS)
          }
        : null
    })),
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
    annotations: {
      where: { userId: user.id },
      orderBy: { createdAt: "desc" as const }
    }
  };

  return prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    include: readerInclude
  });
}

export async function getDashboardCounts() {
  const library = await getCurrentLibrary();
  const visibleLibraryItems = { libraryId: library.id, savedToLibrary: true, archivedAt: null };
  void startQueuedBackgroundJobs({ libraryId: library.id }).catch(() => undefined);
  const [total, unread, ready, archived, jobs] = await Promise.all([
    prisma.item.count({ where: visibleLibraryItems }),
    prisma.item.count({ where: { ...visibleLibraryItems, readingProgress: { lte: 0 } } }),
    prisma.item.count({ where: { ...visibleLibraryItems, status: "ready" } }),
    prisma.item.count({ where: { libraryId: library.id, archivedAt: { not: null } } }),
    prisma.job.findMany({
      where: {
        libraryId: library.id,
        status: { in: actionableJobStatuses() }
      },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return { total, unread, ready, archived, jobs };
}
