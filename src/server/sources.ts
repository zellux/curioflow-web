import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function getLibrarySources() {
  const library = await getCurrentLibrary();

  return prisma.source.findMany({
    where: { libraryId: library.id },
    include: {
      _count: {
        select: { items: true }
      }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });
}
