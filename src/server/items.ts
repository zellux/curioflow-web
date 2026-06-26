import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getInboxItems() {
  const library = await getCurrentLibrary();

  return prisma.item.findMany({
    where: { libraryId: library.id },
    include: {
      document: {
        include: {
          chunks: {
            orderBy: { chunkIndex: "asc" }
          }
        }
      },
      contentObject: true,
      source: true
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function getItemForReader(itemId?: string) {
  const library = await getCurrentLibrary();
  const item = itemId
    ? await prisma.item.findFirst({
        where: { id: itemId, libraryId: library.id },
        include: { document: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } }, contentObject: true }
      })
    : await prisma.item.findFirst({
        where: { libraryId: library.id },
        include: { document: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } }, contentObject: true },
        orderBy: { createdAt: "desc" }
      });

  return item;
}

export async function getDashboardCounts() {
  const library = await getCurrentLibrary();
  const [total, unread, ready, jobs] = await Promise.all([
    prisma.item.count({ where: { libraryId: library.id } }),
    prisma.item.count({ where: { libraryId: library.id, readStatus: "unread" } }),
    prisma.item.count({ where: { libraryId: library.id, status: "ready" } }),
    prisma.job.findMany({
      where: { libraryId: library.id },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return { total, unread, ready, jobs };
}
