import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { chunkText, sha256 } from "@/server/ingest/articles";

const PDF_SOURCE_ID = "manual-pdf-source";
const UPLOAD_DIR = join(process.cwd(), "storage", "uploads");

function loadPdfParser() {
  const runtimeRequire = eval("require") as NodeRequire;
  return runtimeRequire("pdf-parse") as typeof import("pdf-parse");
}

export async function savePdfToCurrentLibrary(file: File) {
  if (file.size === 0) throw new Error("PDF file is empty");
  if (file.type && file.type !== "application/pdf") throw new Error("Only PDF uploads are supported");

  const library = await getCurrentLibrary();
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileSha256 = sha256(bytes);
  const storageKey = `uploads/${fileSha256}.pdf`;
  const canonicalKey = `pdf:${fileSha256}`;
  const originalFilename = file.name || "Untitled.pdf";

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(process.cwd(), "storage", storageKey), bytes);

  const source = await prisma.source.upsert({
    where: { id: PDF_SOURCE_ID },
    update: {},
    create: {
      id: PDF_SOURCE_ID,
      libraryId: library.id,
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
      libraryId: library.id,
      sourceId: source.id,
      contentObjectId: contentObject.id,
      documentId: existingDocument?.id,
      type: "pdf",
      title: existingDocument?.title ?? originalFilename,
      status: existingDocument ? "ready" : "pending",
      readStatus: "unread"
    }
  });

  if (existingDocument) return item;

  const job = await prisma.job.create({
    data: {
      libraryId: library.id,
      contentObjectId: contentObject.id,
      type: "parse_pdf",
      status: "queued",
      payloadJson: JSON.stringify({ itemId: item.id, cachedFileId: cachedFile.id, storageKey })
    }
  });

  const { PDFParse } = loadPdfParser();
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) throw new Error("PDF had no extractable text");

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
      data: chunkText(text, 1000).map((chunk, index) => ({
        documentId: document.id,
        chunkIndex: index,
        text: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
        contentHash: sha256(chunk),
        embeddingModel: null,
        embeddingJson: null,
        metadataJson: JSON.stringify({ source: "pdf-parse-v1" })
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
          finishedAt: new Date()
        }
      })
    ]);

    return prisma.item.findUniqueOrThrow({ where: { id: item.id } });
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
          finishedAt: new Date()
        }
      })
    ]);
    throw error;
  } finally {
    await parser.destroy();
  }
}
