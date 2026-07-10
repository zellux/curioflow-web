import { createHash } from "node:crypto";
import { prisma } from "@/server/db";

type RecordSourceEntryInput = {
  libraryId: string;
  sourceId: string;
  itemId: string;
  entryKey?: string | null;
  url?: string | null;
  title?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
};

function normalizedEntryKey(input: RecordSourceEntryInput) {
  const candidate = input.entryKey?.trim() || input.url?.trim() || input.itemId;
  return createHash("sha256").update(candidate).digest("hex");
}

export async function recordSourceEntry(input: RecordSourceEntryInput) {
  const entryKey = normalizedEntryKey(input);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sourceEntry.findFirst({
      where: {
        sourceId: input.sourceId,
        OR: [{ itemId: input.itemId }, { entryKey }]
      }
    });
    const data = {
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      itemId: input.itemId,
      entryKey,
      url: input.url ?? null,
      title: input.title ?? null,
      author: input.author ?? null,
      publishedAt: input.publishedAt ?? null,
      lastSeenAt: new Date()
    };
    return existing
      ? tx.sourceEntry.update({ where: { id: existing.id }, data })
      : tx.sourceEntry.create({ data });
  });
}
