import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";

type InboxFilter = {
  sourceId?: string | null;
  readStatus?: string | null;
  status?: string | null;
};

export async function getInboxItems(filter: InboxFilter = {}) {
  const library = await getCurrentLibrary();
  const where = {
    libraryId: library.id,
    ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    ...(filter.readStatus ? { readStatus: filter.readStatus } : {}),
    ...(filter.status ? { status: filter.status } : {})
  };

  return prisma.item.findMany({
    where,
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
