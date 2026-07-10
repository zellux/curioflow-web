import type { Document } from "@prisma/client";
import { prisma } from "@/server/db";

const SUMMARY_METADATA_KEYS = [
  "summary",
  "summaryAccountId",
  "summaryError",
  "summaryFailedAt",
  "summaryGeneratedAt",
  "summaryLanguage",
  "summaryModel",
  "summaryProvider",
  "summaryRequestedAt",
  "summarySource",
  "summaryStatus"
];

function metadataRecord(metadataJson: string) {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function summaryOwner(document: Document) {
  const owner = metadataRecord(document.metadataJson).summaryAccountId;
  return typeof owner === "string" ? owner : null;
}

function hasPersonalizedSummaryMetadata(document: Document) {
  const metadata = metadataRecord(document.metadataJson);
  return SUMMARY_METADATA_KEYS.some((key) => key in metadata);
}

function metadataWithoutSummary(document: Document) {
  const metadata = metadataRecord(document.metadataJson);
  for (const key of SUMMARY_METADATA_KEYS) delete metadata[key];
  return JSON.stringify(metadata);
}

async function cloneDocument(document: Document, preserveSummary: boolean, ownerAccountId: string) {
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: document.id },
    orderBy: { chunkIndex: "asc" }
  });
  return prisma.$transaction(async (tx) => {
    const cloned = await tx.document.create({
      data: {
        contentObjectId: document.contentObjectId,
        cachedFileId: document.cachedFileId,
        ownerAccountId,
        contentType: document.contentType,
        title: document.title,
        articleHtml: document.articleHtml,
        text: document.text,
        contentHash: document.contentHash,
        parserVersion: document.parserVersion,
        language: document.language,
        metadataJson: preserveSummary ? document.metadataJson : metadataWithoutSummary(document)
      }
    });
    if (chunks.length > 0) {
      await tx.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: cloned.id,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          contentHash: chunk.contentHash,
          embeddingModel: chunk.embeddingModel,
          embeddingJson: chunk.embeddingJson,
          metadataJson: chunk.metadataJson
        }))
      });
    }
    return cloned;
  });
}

export async function documentForAccountReuse(document: Document, accountId: string) {
  const owner = document.ownerAccountId ?? summaryOwner(document);
  if (!owner && !hasPersonalizedSummaryMetadata(document)) return document;
  if (owner === accountId) return document;
  return cloneDocument(document, false, accountId);
}

export async function ensureAccountSummaryDocument(itemId: string, accountId: string) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { document: true, contentObject: true }
  });
  if (!item?.document) throw new Error("This item does not have article text yet.");

  const otherAccountUsesDocument = await prisma.item.findFirst({
    where: {
      documentId: item.document.id,
      library: { accountId: { not: accountId } }
    },
    select: { id: true }
  });
  const owner = item.document.ownerAccountId ?? summaryOwner(item.document);
  if (owner && owner !== accountId && item.contentObject?.cacheScope === "account_private") {
    throw new Error("Private document belongs to a different account.");
  }
  const mustClone = !owner || Boolean(otherAccountUsesDocument) || owner !== accountId;
  if (!mustClone) return item.document;

  const cloned = await cloneDocument(item.document, owner === accountId, accountId);
  await prisma.item.update({ where: { id: item.id }, data: { documentId: cloned.id } });
  return cloned;
}
