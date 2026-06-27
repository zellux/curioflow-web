import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";

type InboxFilter = {
  query?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  readStatus?: string | null;
  status?: string | null;
  archived?: boolean | null;
};

const INBOX_DOCUMENT_PREVIEW_CHARS = 900;
const INBOX_ITEM_LIMIT = 120;

export async function getInboxItems(filter: InboxFilter = {}) {
  const library = await getCurrentLibrary();
  const query = filter.query?.trim().toLowerCase();
  const activeSource = filter.sourceId
    ? await prisma.source.findFirst({
        where: { id: filter.sourceId, libraryId: library.id },
        select: { type: true }
      })
    : null;
  const includeUnsavedFeedItems = activeSource?.type === "rss" || activeSource?.type === "podcast" || filter.sourceType === "rss";
  const where = {
    libraryId: library.id,
    ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    ...(filter.sourceType ? { source: { is: { type: filter.sourceType } } } : {}),
    ...(filter.readStatus ? { readStatus: filter.readStatus } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(includeUnsavedFeedItems ? {} : { savedToLibrary: true })
  };

  const items = await prisma.item.findMany({
    where,
    include: {
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
    },
    orderBy: { createdAt: "desc" },
    ...(query ? {} : { take: INBOX_ITEM_LIMIT })
  });

  const filteredItems = query
    ? items.filter((item) => {
        const haystack = [item.title, item.url, item.author, item.source?.name, item.document?.title, item.document?.text]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
    : items;

  return filteredItems.slice(0, INBOX_ITEM_LIMIT).map((item) => ({
    ...item,
    document: item.document
      ? {
          ...item.document,
          text: item.document.text.slice(0, INBOX_DOCUMENT_PREVIEW_CHARS)
        }
      : null
  }));
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
  const [total, unread, ready, archived, jobs] = await Promise.all([
    prisma.item.count({ where: visibleLibraryItems }),
    prisma.item.count({ where: { ...visibleLibraryItems, readStatus: "unread" } }),
    prisma.item.count({ where: { ...visibleLibraryItems, status: "ready" } }),
    prisma.item.count({ where: { libraryId: library.id, savedToLibrary: true, archivedAt: { not: null } } }),
    prisma.job.findMany({
      where: { libraryId: library.id },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return { total, unread, ready, archived, jobs };
}
