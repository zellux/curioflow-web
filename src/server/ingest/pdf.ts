import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/server/db";
import { getCurrentLibrary, manualPdfSourceId } from "@/server/auth";
import { chunkText, sha256 } from "@/server/ingest/articles";
import { serializeJobProgress } from "@/server/job-progress";
import { enqueueArticleSummaryGeneration } from "@/server/summaries";

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
  const fileSha256 = sha256(bytes);
  const storageKey = `uploads/${fileSha256}.pdf`;
  const canonicalKey = `pdf:${fileSha256}`;
  const originalFilename = file.name || "Untitled.pdf";
  const pdfSourceId = manualPdfSourceId(libraryId);

  await mkdir(UPLOAD_DIR, { recursive: true });
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
    where: { fileSha256 },
    update: {},
    create: {
      fileSha256,
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

  if (existingDocument) {
    await enqueueArticleSummaryGeneration({ libraryId, itemId: item.id });
    return item;
  }

  const job = await prisma.job.create({
    data: {
      libraryId,
      contentObjectId: contentObject.id,
      type: "parse_pdf",
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        itemId: item.id,
        cachedFileId: cachedFile.id
      }),
      payloadJson: JSON.stringify({ itemId: item.id, cachedFileId: cachedFile.id, storageKey })
    }
  });

  const { PDFParse } = loadPdfParser();
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) throw new Error("PDF had no extractable text");
    const pageChunks = chunkPdfPages(result.pages);
    const chunksToPersist = pageChunks.length
      ? pageChunks
      : chunkText(text, 1000).map((chunk, chunkInPage) => ({
          text: chunk,
          pageNumber: 1,
          chunkInPage
        }));

    const document = await prisma.document.create({
      data: {
        contentObjectId: contentObject.id,
        cachedFileId: cachedFile.id,
        contentType: "pdf_text",
        title: originalFilename,
        text,
        contentHash: sha256(text),
        parserVersion: "pdf-parse-v1",
        metadataJson: JSON.stringify({
          parser: "pdf-parse",
          originalFilename,
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

    await prisma.$transaction([
      prisma.contentObject.update({
        where: { id: contentObject.id },
        data: {
          latestDocumentId: document.id,
          status: "ready"
        }
      }),
      prisma.item.update({
        where: { id: item.id },
        data: {
          documentId: document.id,
          title: originalFilename,
          status: "ready"
        }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          startedAt: job.createdAt,
          finishedAt: new Date(),
          progressJson: serializeJobProgress({
            stage: "succeeded",
            itemId: item.id,
            documentId: document.id,
            chunks: chunksToPersist.length
          })
        }
      })
    ]);

    const savedItem = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    await enqueueArticleSummaryGeneration({ libraryId, itemId: savedItem.id });
    return savedItem;
  } catch (error) {
    await prisma.$transaction([
      prisma.contentObject.update({
        where: { id: contentObject.id },
        data: { status: "failed" }
      }),
      prisma.item.update({
        where: { id: item.id },
        data: { status: "failed" }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to parse PDF",
          startedAt: job.createdAt,
          finishedAt: new Date(),
          progressJson: serializeJobProgress({
            stage: "failed",
            itemId: item.id,
            message: error instanceof Error ? error.message : "Unable to parse PDF"
          })
        }
      })
    ]);
    throw error;
  } finally {
    await parser.destroy();
  }
}

export async function savePdfToCurrentLibrary(file: File) {
  const library = await getCurrentLibrary();
  return savePdfToLibrary(library.id, file);
}
