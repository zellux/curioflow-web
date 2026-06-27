import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";

type InboxFilter = {
  query?: string | null;
  sourceId?: string | null;
  readStatus?: string | null;
  status?: string | null;
  archived?: boolean | null;
};

export async function getInboxItems(filter: InboxFilter = {}) {
  const library = await getCurrentLibrary();
  const query = filter.query?.trim().toLowerCase();
  const activeSource = filter.sourceId
    ? await prisma.source.findFirst({
        where: { id: filter.sourceId, libraryId: library.id },
        select: { type: true }
      })
    : null;
  const includeUnsavedFeedItems = activeSource?.type === "rss" || activeSource?.type === "podcast";
  const where = {
    libraryId: library.id,
    ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    ...(filter.readStatus ? { readStatus: filter.readStatus } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(includeUnsavedFeedItems ? {} : { savedToLibrary: true })
  };

  const items = await prisma.item.findMany({
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

  if (!query) return items;

  return items.filter((item) => {
    const haystack = [item.title, item.url, item.author, item.source?.name, item.document?.title, item.document?.text]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
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
