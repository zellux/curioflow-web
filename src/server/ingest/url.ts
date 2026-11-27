import { prisma } from "@/server/db";
import { getCurrentLibrary, manualUrlSourceId } from "@/server/auth";
import { saveArticleItemWithStatus } from "@/server/ingest/articles";
import { articleFetchHeadersForUrl } from "@/server/ingest/extractors/article";
import { PDF_SIGNATURE, savePdfWithStatus } from "@/server/ingest/pdf";
import { maxPdfUploadBytes } from "@/server/entitlement-limits";
import { fetchBytesWithPolicy } from "@/server/outbound-http";

async function downloadLinkedPdf(url: string) {
  const download = await fetchBytesWithPolicy(url, {
    headers: { ...articleFetchHeadersForUrl(url), accept: "application/pdf,application/octet-stream,*/*;q=0.8" },
    maxBytes: maxPdfUploadBytes(),
    requiredBodyPrefix: PDF_SIGNATURE,
    timeoutMs: 10000
  }).catch(() => null);
  if (!download || download.status !== 200) return null;

  const path = new URL(download.finalUrl).pathname;
  const filename = path.split("/").pop() || "Untitled.pdf";
  let decodedName = filename;
  try {
    decodedName = decodeURIComponent(filename);
  } catch {
    // Use the URL segment as written if it cannot be decoded.
  }
  const pdfName = decodedName.toLowerCase().endsWith(".pdf") ? decodedName : `${decodedName}.pdf`;
  return { bytes: download.bytes, filename: pdfName };
}

export async function saveUrlToLibrary(libraryId: string, inputUrl: string, title?: string) {
  const { item } = await saveUrlWithStatus(libraryId, inputUrl, title);
  return item;
}

export async function saveUrlWithStatus(libraryId: string, inputUrl: string, title?: string) {
  const trimmedUrl = inputUrl.trim();
  const downloadUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
  const cleanTitle = title?.trim().slice(0, 512);
  const pdf = await downloadLinkedPdf(downloadUrl);
  if (pdf) return savePdfWithStatus(libraryId, pdf.bytes, pdf.filename, { url: downloadUrl, title: cleanTitle });

  const sourceId = manualUrlSourceId(libraryId);
  const source = await prisma.source.upsert({
    where: { id: sourceId },
    update: {},
    create: {
      id: sourceId,
      libraryId,
      type: "url",
      name: "Saved URLs"
    }
  });

  return saveArticleItemWithStatus({
    libraryId,
    sourceId: source.id,
    url: inputUrl,
    title: cleanTitle
  });
}

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  return saveUrlToLibrary(library.id, inputUrl);
}
