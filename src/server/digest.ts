import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getRecentDigestItems() {
  const library = await getCurrentLibrary();

  return prisma.item.findMany({
    where: {
      libraryId: library.id,
      savedToLibrary: true,
      archivedAt: null,
      documentId: { not: null }
    },
    include: {
      source: true,
      contentObject: true,
      document: true
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 8
  });
}
