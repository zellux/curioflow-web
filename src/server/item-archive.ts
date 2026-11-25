import type { Prisma } from "@prisma/client";
import { SOURCE_TYPE } from "@/server/item-state";

type ArchiveDb = { sourceEntry: Pick<Prisma.TransactionClient["sourceEntry"], "count"> };

// Archiving a subscription item also takes it out of Library, and unarchiving does
// not put it back: it returns to its subscription list and must be saved again.
// Items with no active subscription (manual saves, PDFs) have nowhere else to show,
// so they keep savedToLibrary.
export async function archiveClearsLibrary(db: ArchiveDb, itemId: string) {
  const entries = await db.sourceEntry.count({
    where: {
      itemId,
      source: { type: { in: [SOURCE_TYPE.RSS, SOURCE_TYPE.NEWSLETTER] }, status: { not: "unsubscribed" } }
    }
  });
  return entries > 0;
}

// Applies the rule to an item update: when the update archives an item that was not
// archived yet, it also clears savedToLibrary where archiveClearsLibrary says so.
export async function withArchiveLibraryRule<T extends { archivedAt?: Date | null; savedToLibrary?: boolean }>(
  db: ArchiveDb,
  item: { id: string; archivedAt: Date | null },
  data: T
): Promise<T> {
  if (!data.archivedAt || item.archivedAt) return data;
  return await archiveClearsLibrary(db, item.id) ? { ...data, savedToLibrary: false } : data;
}
