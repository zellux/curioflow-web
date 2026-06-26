import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getLibrarySources() {
  const library = await getCurrentLibrary();

  return prisma.source.findMany({
    where: {
      libraryId: library.id,
      status: { not: "unsubscribed" }
    },
    include: {
      items: {
        where: { savedToLibrary: true },
        select: { id: true }
      },
      _count: {
        select: { items: true }
      }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });
}

export async function unsubscribeSourceFromCurrentLibrary(sourceId: string, { keepItems }: { keepItems: boolean }) {
  const library = await getCurrentLibrary();
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      libraryId: library.id,
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
          prisma.item.deleteMany({ where: { id: { in: itemIds }, libraryId: library.id } })
        ])
  ]);

  return {
    sourceId: source.id,
    removedItems: keepItems ? 0 : itemIds.length,
    keptItems: keepItems ? itemIds.length : 0
  };
}
