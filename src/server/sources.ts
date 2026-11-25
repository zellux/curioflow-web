import { tryCleanupDeletedArticleImages } from "@/server/article-image-cleanup";
import { decodeFeedTextEntities } from "@/server/ingest/feed-text";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { READ_STATUS, READING_COMPLETION_THRESHOLD } from "@/server/item-state";

export async function getLibrarySourcesForLibrary(libraryId: string) {
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, select: { accountId: true } });
  const visibleItem = { deletedAt: null, OR: [{ documentId: null }, { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }] };
  const sources = await prisma.source.findMany({
    where: {
      libraryId,
      type: { not: "podcast" },
      status: { not: "unsubscribed" }
    },
    include: {
      _count: {
        select: { entries: { where: { item: visibleItem } } }
      }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });
  const pending = await prisma.sourceEntry.groupBy({
    by: ["sourceId"],
    where: { source: { libraryId }, item: { ...visibleItem, archivedAt: null, savedToLibrary: false } },
    _count: true
  });
  // Unread: not finished and not archived (archiving is a way of dismissing an item).
  const unreadItem = { ...visibleItem, archivedAt: null, readingProgress: { lt: READING_COMPLETION_THRESHOLD } };
  const unread = await prisma.sourceEntry.groupBy({
    by: ["sourceId"],
    where: { source: { libraryId }, item: unreadItem },
    _count: true
  });
  const streamUnreadCounts = Object.fromEntries(await Promise.all(["rss", "newsletter"].map(async (type) => [type, await prisma.item.count({
    where: { libraryId, ...unreadItem, sourceEntries: { some: { source: { type, status: { not: "unsubscribed" } } } } }
  })])));
  const streamCounts = Object.fromEntries(await Promise.all(["rss", "newsletter"].map(async (type) => [type, await prisma.item.count({
    where: { libraryId, ...visibleItem, sourceEntries: { some: { source: { type, status: { not: "unsubscribed" } } } } }
  })])));
  return sources.map((source) => ({
    ...source,
    name: decodeFeedTextEntities(source.name),
    streamCount: streamCounts[source.type] ?? 0,
    streamUnreadCount: streamUnreadCounts[source.type] ?? 0,
    unreadCount: unread.find((row) => row.sourceId === source.id)?._count ?? 0,
    pendingCount: pending.find((row) => row.sourceId === source.id)?._count ?? 0,
    _count: { items: source._count.entries }
  }));
}

export async function getLibrarySources() {
  const library = await getCurrentLibrary();
  return getLibrarySourcesForLibrary(library.id);
}

export async function unsubscribeSourceFromLibrary(libraryId: string, sourceId: string, { keepItems }: { keepItems: boolean }) {
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      libraryId,
      type: { in: ["rss", "newsletter"] }
    },
    include: {
      entries: {
        include: {
          item: {
            select: {
              id: true,
              sourceId: true,
              sourceEntries: {
                where: {
                  sourceId: { not: sourceId },
                  source: { status: { not: "unsubscribed" } }
                },
                select: { sourceId: true },
                take: 1
              }
            }
          }
        }
      }
    }
  });

  if (!source) return null;

  const itemIds = source.entries.map((entry) => entry.item.id);
  const sharedItems = source.entries
    .map((entry) => ({ id: entry.item.id, replacementSourceId: entry.item.sourceEntries[0]?.sourceId }))
    .filter((entry): entry is { id: string; replacementSourceId: string } => Boolean(entry.replacementSourceId));
  const sharedItemIds = new Set(sharedItems.map((entry) => entry.id));
  const exclusiveItemIds = itemIds.filter((itemId) => !sharedItemIds.has(itemId));
  await prisma.$transaction([
    prisma.source.update({
      where: { id: source.id },
      data: { status: "unsubscribed" }
    }),
    prisma.sourceEntry.deleteMany({ where: { sourceId: source.id } }),
    ...sharedItems
      .filter((entry) => source.entries.some((sourceEntry) => sourceEntry.item.id === entry.id && sourceEntry.item.sourceId === source.id))
      .map((entry) => prisma.item.update({
        where: { id: entry.id },
        data: { sourceId: entry.replacementSourceId }
      })),
    ...(keepItems && exclusiveItemIds.length > 0
      ? [prisma.item.updateMany({
          where: { id: { in: exclusiveItemIds }, libraryId, sourceId: source.id },
          data: { sourceId: null }
        })]
      : []),
    ...(keepItems || exclusiveItemIds.length === 0
      ? []
      : [
          prisma.annotation.deleteMany({ where: { itemId: { in: exclusiveItemIds } } }),
          prisma.chatThread.updateMany({ where: { itemId: { in: exclusiveItemIds } }, data: { itemId: null } }),
          prisma.item.deleteMany({ where: { id: { in: exclusiveItemIds }, libraryId } })
        ])
  ]);

  if (!keepItems) {
    for (const itemId of exclusiveItemIds) await tryCleanupDeletedArticleImages(itemId);
  }

  return {
    sourceId: source.id,
    removedItems: keepItems ? 0 : exclusiveItemIds.length,
    keptItems: keepItems ? itemIds.length : sharedItems.length
  };
}

export async function unsubscribeSourceFromCurrentLibrary(sourceId: string, { keepItems }: { keepItems: boolean }) {
  const library = await getCurrentLibrary();
  return unsubscribeSourceFromLibrary(library.id, sourceId, { keepItems });
}

export type SourceStreamScope = { sourceId: string } | { sourceType: "rss" | "newsletter" };

// Marks every unfinished item in one subscription source, or in all feeds or all
// newsletters, as read. lastReadAt stays as it is: these items were not opened.
export async function markSourceStreamReadForLibrary(libraryId: string, scope: SourceStreamScope) {
  const sourceWhere = "sourceId" in scope
    ? { id: scope.sourceId, libraryId, type: { in: ["rss", "newsletter"] } }
    : { libraryId, type: scope.sourceType, status: { not: "unsubscribed" } };
  const result = await prisma.item.updateMany({
    where: {
      libraryId,
      deletedAt: null,
      readingProgress: { lt: READING_COMPLETION_THRESHOLD },
      sourceEntries: { some: { source: sourceWhere } }
    },
    data: { readingProgress: 1, readStatus: READ_STATUS.DONE }
  });
  return result.count;
}

export async function markSourceStreamRead(scope: SourceStreamScope) {
  const library = await getCurrentLibrary();
  return markSourceStreamReadForLibrary(library.id, scope);
}
