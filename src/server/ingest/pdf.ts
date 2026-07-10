import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { prisma } from "@/server/db";
import { getCurrentLibrary, manualPdfSourceId } from "@/server/auth";
import { chunkText, sha256 } from "@/server/ingest/articles";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { enqueueArticleSummaryGeneration } from "@/server/summaries";
import { recordSourceEntry } from "@/server/source-entries";
import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import { maxPdfUploadBytes } from "@/server/entitlements";

const UPLOAD_DIR = join(process.cwd(), "storage", "uploads");

type PdfPage = {
  num: number;
  text: string;
};

type PdfChunk = {
  text: string;
  pageNumber: number;
  chunkInPage: number;
};

function loadPdfParser() {
  const runtimeRequire = eval("require") as NodeRequire;
  return runtimeRequire("pdf-parse") as typeof import("pdf-parse");
}

function chunkPdfPages(pages: PdfPage[], targetChars = 1000) {
  const chunks: PdfChunk[] = [];

  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) continue;

    chunkText(pageText, targetChars).forEach((chunk, chunkInPage) => {
      chunks.push({
        text: chunk,
        pageNumber: page.num,
        chunkInPage
      });
    });
  }

  return chunks;
}

export async function savePdfToLibrary(libraryId: string, file: File) {
  if (file.size === 0) throw new Error("PDF file is empty");
  if (file.type && file.type !== "application/pdf") throw new Error("Only PDF uploads are supported");

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Uploaded file is not a valid PDF");
  }
  const library = await prisma.library.findUniqueOrThrow({
    where: { id: libraryId },
    select: { accountId: true }
  });
  const fileSha256 = sha256(bytes);
  const accountStorageKey = sha256(library.accountId);
  const scopedFileSha256 = sha256(`${library.accountId}:${fileSha256}`);
  const storageKey = `uploads/${accountStorageKey}/${fileSha256}.pdf`;
  const canonicalKey = `pdf:${library.accountId}:${fileSha256}`;
  const originalFilename = file.name || "Untitled.pdf";
  const pdfSourceId = manualPdfSourceId(libraryId);

  await mkdir(join(UPLOAD_DIR, accountStorageKey), { recursive: true });
  await writeFile(join(process.cwd(), "storage", storageKey), bytes);

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

  const cachedFile = await prisma.cachedFile.upsert({
    where: { fileSha256: scopedFileSha256 },
    update: {},
    create: {
      fileSha256: scopedFileSha256,
      storageKey,
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
      originalFilename
    }
  });

  const contentObject = await prisma.contentObject.upsert({
    where: { canonicalKey },
    update: { lastSeenAt: new Date() },
    create: {
      canonicalKey,
      type: "pdf",
      cacheScope: "account_private",
      fileSha256,
      status: "pending"
    }
  });

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findUnique({ where: { id: contentObject.latestDocumentId } })
      : null) ??
    (await prisma.document.findFirst({
      where: { contentObjectId: contentObject.id },
      orderBy: { createdAt: "desc" }
    }));

  const item = await prisma.item.create({
    data: {
      libraryId,
      sourceId: source.id,
      contentObjectId: contentObject.id,
      documentId: existingDocument?.id,
      type: "pdf",
      title: existingDocument?.title ?? originalFilename,
      status: existingDocument ? "ready" : "pending"
    }
  });
  await recordSourceEntry({
    libraryId,
    sourceId: source.id,
    itemId: item.id,
    entryKey: fileSha256,
    title: originalFilename
  });

  if (existingDocument) {
    await enqueueArticleSummaryGeneration({ libraryId, itemId: item.id });
    return item;
  }

  await prisma.job.create({
    data: {
      libraryId,
      contentObjectId: contentObject.id,
      type: BACKGROUND_JOB_TYPES.PARSE_PDF,
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        itemId: item.id,
        cachedFileId: cachedFile.id
      }),
      payloadJson: JSON.stringify({ itemId: item.id, cachedFileId: cachedFile.id, storageKey })
    }
  });

  return item;
}

type PdfJobPayload = {
  itemId?: string;
  cachedFileId?: string;
  storageKey?: string;
};

function parsePdfJobPayload(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as PdfJobPayload;
  if (!payload.itemId || !payload.cachedFileId || !payload.storageKey) {
    throw new Error("PDF job payload is incomplete");
  }
  return payload as Required<PdfJobPayload>;
}

function pdfStoragePath(storageKey: string) {
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
  const payload = parsePdfJobPayload(job.payloadJson);
  const [item, cachedFile] = await Promise.all([
    prisma.item.findFirst({ where: { id: payload.itemId, libraryId: job.libraryId } }),
    prisma.cachedFile.findUnique({ where: { id: payload.cachedFileId } })
  ]);
  if (!item || !cachedFile || cachedFile.storageKey !== payload.storageKey) {
    throw new Error("PDF parse job references missing content");
  }
  const documentTitle = cachedFile.originalFilename ?? item.title;

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;
  let parser: InstanceType<ReturnType<typeof loadPdfParser>["PDFParse"]> | null = null;
  try {
    await updateJobProgress(job.id, { stage: "reading_pdf", itemId: item.id }, claimed);
    const bytes = await readFile(pdfStoragePath(payload.storageKey));
    if (bytes.byteLength > maxPdfUploadBytes()) throw new Error("PDF file exceeds the configured limit");
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Stored file is not a valid PDF");

    const { PDFParse } = loadPdfParser();
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) throw new Error("PDF had no extractable text");
    const pageChunks = chunkPdfPages(result.pages);
    const chunksToPersist = pageChunks.length
      ? pageChunks
      : chunkText(text, 1000).map((chunk, chunkInPage) => ({ text: chunk, pageNumber: 1, chunkInPage }));

    await updateJobProgress(job.id, { stage: "persisting_document", itemId: item.id }, claimed);
    const document = await prisma.document.create({
      data: {
        contentObjectId: job.contentObjectId,
        cachedFileId: cachedFile.id,
        contentType: "pdf_text",
        title: documentTitle,
        text,
        contentHash: sha256(text),
        parserVersion: "pdf-parse-v1",
        metadataJson: JSON.stringify({
          parser: "pdf-parse",
          originalFilename: documentTitle,
          byteSize: bytes.byteLength,
          extractedAt: new Date().toISOString()
        })
      }
    });
    await prisma.documentChunk.createMany({
      data: chunksToPersist.map((chunk, index) => ({
        documentId: document.id,
        chunkIndex: index,
        text: chunk.text,
        tokenCount: Math.ceil(chunk.text.length / 4),
        contentHash: sha256(chunk.text),
        embeddingModel: null,
        embeddingJson: null,
        metadataJson: JSON.stringify({
          source: "pdf-parse-v1",
          pageNumber: chunk.pageNumber,
          chunkInPage: chunk.chunkInPage
        })
      }))
    });

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.contentObject.update({
        where: { id: job.contentObjectId! },
        data: { latestDocumentId: document.id, status: "ready" }
      });
      await tx.item.update({
        where: { id: item.id },
        data: { documentId: document.id, title: documentTitle, status: "ready" }
      });
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          progressJson: serializeJobProgress({
            stage: "succeeded",
            itemId: item.id,
            documentId: document.id,
            chunks: chunksToPersist.length
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
    await enqueueArticleSummaryGeneration({ libraryId: job.libraryId, itemId: item.id });
  } catch (error) {
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status !== "ignored") {
      await prisma.$transaction([
        prisma.contentObject.update({ where: { id: job.contentObjectId }, data: { status: "failed" } }),
        prisma.item.update({ where: { id: item.id }, data: { status: "failed" } })
      ]);
    }
  } finally {
    await parser?.destroy();
  }
}

export async function savePdfToCurrentLibrary(file: File) {
  const library = await getCurrentLibrary();
  return savePdfToLibrary(library.id, file);
}
