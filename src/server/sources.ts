import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getLibrarySourcesForLibrary(libraryId: string) {
  return prisma.source.findMany({
    where: {
      libraryId,
      status: { not: "unsubscribed" }
    },
    include: {
      _count: {
        select: { items: true }
      }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });
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
      type: "rss"
    },
    include: {
      items: { select: { id: true } }
    }
  });

  if (!source) return null;

  const itemIds = source.items.map((item) => item.id);
  await prisma.$transaction([
    prisma.source.update({
      where: { id: source.id },
      data: { status: "unsubscribed" }
    }),
    ...(keepItems || itemIds.length === 0
      ? []
      : [
          prisma.annotation.deleteMany({ where: { itemId: { in: itemIds } } }),
          prisma.chatThread.updateMany({ where: { itemId: { in: itemIds } }, data: { itemId: null } }),
          prisma.item.deleteMany({ where: { id: { in: itemIds }, libraryId } })
        ])
  ]);

  return {
    sourceId: source.id,
    removedItems: keepItems ? 0 : itemIds.length,
    keptItems: keepItems ? itemIds.length : 0
  };
}

export async function unsubscribeSourceFromCurrentLibrary(sourceId: string, { keepItems }: { keepItems: boolean }) {
  const library = await getCurrentLibrary();
  return unsubscribeSourceFromLibrary(library.id, sourceId, { keepItems });
}
