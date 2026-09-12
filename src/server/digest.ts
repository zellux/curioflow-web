import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getRecentDigestItems() {
  const library = await getCurrentLibrary();

  return prisma.item.findMany({
    where: {
      libraryId: library.id,
      savedToLibrary: true,
      archivedAt: null,
      deletedAt: null,
      status: "ready",
      documentId: { not: null },
      document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } }
    },
    include: {
      source: true,
      contentObject: true,
      document: true
    },
    orderBy: [{ activityAt: "desc" }, { createdAt: "desc" }],
    take: 8
  });
}

export async function getTodayReadableSaveCount() {
  const library = await getCurrentLibrary();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.item.count({ where: {
    libraryId: library.id, savedToLibrary: true, deletedAt: null, archivedAt: null, status: "ready",
    createdAt: { gte: today }, documentId: { not: null },
    document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } }
  } });
}
