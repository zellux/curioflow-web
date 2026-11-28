import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { createHash, randomUUID, type BinaryLike } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { isUniqueConstraintError, prisma } from "@/server/db";
import { manualPdfSourceId } from "@/server/auth";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { serializeJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import { maxPdfUploadBytes } from "@/server/entitlements";

const UPLOAD_DIR = join(process.cwd(), "storage", "uploads");
export const PDF_SIGNATURE = "%PDF-";

function sha256(value: BinaryLike) {
  return createHash("sha256").update(value).digest("hex");
}

export function pdfFilenameFromUrl(finalUrl: string) {
  const path = new URL(finalUrl).pathname;
  const filename = path.split("/").pop() || "Untitled.pdf";
  let decodedName = filename;
  try {
    decodedName = decodeURIComponent(filename);
  } catch {
    // Use the URL segment as written if it cannot be decoded.
  }
  return decodedName.toLowerCase().endsWith(".pdf") ? decodedName : `${decodedName}.pdf`;
}

export async function storePdfFileForAccount(accountId: string, bytes: Uint8Array, filename: string) {
  if (bytes.byteLength === 0) throw new Error("PDF file is empty");
  if (bytes.byteLength > maxPdfUploadBytes()) throw new Error("PDF file exceeds the configured limit");
  if (new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length)) !== PDF_SIGNATURE) {
    throw new Error("File is not a valid PDF");
  }
  const fileSha256 = sha256(bytes);
  const accountStorageKey = sha256(accountId);
  const scopedFileSha256 = sha256(`${accountId}:${fileSha256}`);
  const storageKey = `uploads/${accountStorageKey}/${fileSha256}.pdf`;
  const originalFilename = filename || "Untitled.pdf";

  await mkdir(join(UPLOAD_DIR, accountStorageKey), { recursive: true });
  const filePath = join(process.cwd(), "storage", storageKey);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  const cachedFile = await prisma.cachedFile.upsert({
    where: { fileSha256: scopedFileSha256 },
    update: { ownerAccountId: accountId },
    create: {
      fileSha256: scopedFileSha256,
      storageKey,
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
      originalFilename,
      ownerAccountId: accountId
    }
  });

  return { cachedFile, fileSha256, scopedFileSha256, originalFilename };
}

export async function savePdfToLibrary(libraryId: string, file: File) {
  if (file.size > maxPdfUploadBytes()) throw new Error("PDF file exceeds the configured limit");
  if (file.type && file.type !== "application/pdf") throw new Error("Only PDF uploads are supported");
  const { item } = await savePdfWithStatus(libraryId, new Uint8Array(await file.arrayBuffer()), file.name);
  return item;
}

export async function savePdfWithStatus(libraryId: string, bytes: Uint8Array, filename: string, link?: { url: string; title?: string }) {
  const library = await prisma.library.findUniqueOrThrow({
    where: { id: libraryId },
    select: { accountId: true }
  });
  const { cachedFile, fileSha256, scopedFileSha256, originalFilename } = await storePdfFileForAccount(library.accountId, bytes, filename);
  const canonicalKey = `pdf:${library.accountId}:${fileSha256}`;
  const title = link?.title || originalFilename;
  const pdfSourceId = manualPdfSourceId(libraryId);

  const source = await prisma.source.upsert({
    where: { id: pdfSourceId },
    update: {},
    create: {
      id: pdfSourceId,
      libraryId,
      type: "pdf",
      name: "PDF Uploads"
    }
  });

  const upsertContentObject = () => prisma.contentObject.upsert({
    where: { canonicalKey },
    update: { lastSeenAt: new Date(), ownerAccountId: library.accountId },
    create: {
      canonicalKey,
      type: "pdf",
      cacheScope: "account_private",
      ownerAccountId: library.accountId,
      fileSha256: scopedFileSha256,
      status: "pending"
    }
  });
  // Postgres upserts resolve conflicts on canonical_key only, so a concurrent first
  // upload of the same file fails on file_sha256. The row exists by then; retry once.
  const contentObject = await upsertContentObject().catch(error => {
    if (!isUniqueConstraintError(error, "file_sha256")) throw error;
    return upsertContentObject();
  });

  return prisma.$transaction(async tx => {
    const documentId = await ensurePdfDocument(tx, contentObject.id, cachedFile, library.accountId, originalFilename);
    const existing = await tx.item.findUnique({
      where: { libraryId_contentObjectId: { libraryId, contentObjectId: contentObject.id } }
    });
    const item = existing
      ? await tx.item.update({
          where: { id: existing.id },
          data: {
            ...(existing.deletedAt ? { deletedAt: null, archivedAt: null, savedToLibrary: true } : {}),
            ...(!existing.url && link ? { url: link.url } : {}),
            ...(!existing.documentId ? { documentId, status: "ready" } : {})
          }
        })
      : await tx.item.create({
          data: {
            libraryId, sourceId: source.id, contentObjectId: contentObject.id,
            documentId, type: "pdf",
            title, url: link?.url, status: "ready"
          }
        });
    await tx.sourceEntry.upsert({
      where: { sourceId_itemId: { sourceId: source.id, itemId: item.id } },
      update: { lastSeenAt: new Date(), url: item.url },
      create: { libraryId, sourceId: source.id, itemId: item.id, entryKey: sha256(fileSha256), title, url: item.url }
    });
    return { item, alreadySaved: Boolean(existing && !existing.deletedAt) };
  });
}

export async function ensurePdfDocument(
  tx: Prisma.TransactionClient,
  contentObjectId: string,
  file: { id: string; fileSha256: string },
  ownerAccountId: string,
  title: string
) {
  // Serialize parallel uploads and legacy jobs for the same file.
  const content = await tx.contentObject.update({
    where: { id: contentObjectId },
    data: { lastSeenAt: new Date() }
  });
  const existing = await tx.document.findFirst({
    where: {
      contentObjectId,
      cachedFileId: file.id,
      OR: [{ ownerAccountId: null }, { ownerAccountId }]
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const document = existing ?? await tx.document.create({
    data: {
      contentObjectId,
      cachedFileId: file.id,
      ownerAccountId,
      contentType: "pdf",
      title,
      text: "",
      contentHash: file.fileSha256,
      parserVersion: "none"
    },
    select: { id: true }
  });
  if (content.latestDocumentId !== document.id || content.status !== "ready") {
    await tx.contentObject.update({
      where: { id: contentObjectId },
      data: { latestDocumentId: document.id, status: "ready" }
    });
  }
  return document.id;
}

type PdfItem = {
  id: string;
  title: string;
  contentObjectId: string | null;
  documentId: string | null;
  document?: { cachedFileId: string | null } | null;
  contentObject?: { fileSha256: string | null } | null;
};

export async function findPdfFile(item: PdfItem, accountId: string) {
  const fileId = item.document?.cachedFileId;
  const fileSha256 = item.contentObject?.fileSha256;
  if (!fileId && !fileSha256) return null;

  return prisma.cachedFile.findFirst({
    where: {
      mimeType: "application/pdf",
      OR: [{ ownerAccountId: accountId }, { ownerAccountId: null }],
      ...(fileId ? { id: fileId } : { fileSha256: fileSha256! })
    }
  });
}

export async function attachLegacyPdfDocument(item: PdfItem, accountId: string) {
  if (item.documentId || !item.contentObjectId) return item.documentId;
  const file = await findPdfFile(item, accountId);
  if (!file) return null;
  return prisma.$transaction(async tx => {
    const documentId = await ensurePdfDocument(tx, item.contentObjectId!, file, accountId, item.title);
    await tx.item.updateMany({
      where: { id: item.id, documentId: null, deletedAt: null },
      data: { documentId, status: "ready" }
    });
    return documentId;
  });
}

export function pdfStoragePath(storageKey: string) {
  const storageRoot = resolve(process.cwd(), "storage");
  const path = resolve(storageRoot, storageKey);
  if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error("PDF storage key is invalid");
  return path;
}

export async function processPdfJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.libraryId || !job.contentObjectId || job.type !== BACKGROUND_JOB_TYPES.PARSE_PDF) {
    throw new Error("PDF parse job not found");
  }
  // Finish jobs queued by older releases using the original file.
  const claimed = await claimQueuedJob(job);
  if (!claimed) return;
  try {
    const { itemId } = JSON.parse(job.payloadJson) as { itemId?: string };
    if (!itemId) throw new Error("PDF job payload is incomplete");
    const item = await prisma.item.findFirst({
      where: { id: itemId, libraryId: job.libraryId, contentObjectId: job.contentObjectId },
      include: { library: { select: { accountId: true } }, contentObject: true, document: true }
    });
    if (!item) throw new Error("PDF job references a missing item");
    const file = await findPdfFile(item, item.library.accountId);
    if (!file || !(await stat(pdfStoragePath(file.storageKey))).isFile()) throw new Error("PDF file is missing");

    await prisma.$transaction(async tx => {
      await assertJobLease(tx, claimed);
      const documentId = item.documentId ?? await ensurePdfDocument(
        tx, job.contentObjectId!, file, item.library.accountId, item.title
      );
      await tx.item.updateMany({
        where: { id: item.id, documentId: null, deletedAt: null },
        data: { documentId, status: "ready" }
      });
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          progressJson: serializeJobProgress({ stage: "succeeded", itemId: item.id, documentId })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
  } catch (error) {
    await recordBackgroundJobFailure(job.id, error, claimed);
  }
}
