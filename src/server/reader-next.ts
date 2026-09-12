import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

/** Follow the same stable chronology as the RSS inbox, including across page boundaries. */
export async function getNextRssItem(item: { id: string; feedAt: Date; createdAt: Date; archivedAt: Date | null; savedToLibrary: boolean }, query: Record<string, string | undefined>) {
  if (item.archivedAt || item.savedToLibrary || query.filter === "archive") return null;
  const library = await getCurrentLibrary();
  const source = query.source ? await prisma.source.findFirst({ where: { id: query.source, libraryId: library.id, type: "rss", status: { not: "unsubscribed" } } }) : null;
  if (query.filter !== "recent-posts" && !source) return null;
  return prisma.item.findFirst({
    where: {
      libraryId: library.id, deletedAt: null, archivedAt: null, savedToLibrary: false,
      sourceEntries: { some: source ? { sourceId: source.id } : { source: { type: "rss", status: { not: "unsubscribed" } } } },
      AND: [
        { OR: [{ documentId: null }, { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }] },
        { OR: [
          { feedAt: { lt: item.feedAt } },
          { feedAt: item.feedAt, createdAt: { lt: item.createdAt } },
          { feedAt: item.feedAt, createdAt: item.createdAt, id: { gt: item.id } }
        ] }
      ]
    },
    select: { id: true, title: true },
    orderBy: [{ feedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }]
  });
}
