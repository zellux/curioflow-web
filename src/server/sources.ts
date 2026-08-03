import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getLibrarySourcesForLibrary(libraryId: string) {
  const sources = await prisma.source.findMany({
    where: {
      libraryId,
      status: { not: "unsubscribed" }
    },
    include: {
      _count: {
        select: { entries: true }
      }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });
  return sources.map((source) => ({
    ...source,
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
      type: { in: ["rss", "newsletter", "podcast"] }
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
