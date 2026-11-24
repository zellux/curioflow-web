import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { prisma } from "@/server/db";
import { findPdfFile, pdfStoragePath } from "@/server/ingest/pdf";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, library] = await Promise.all([context.params, requireCurrentLibrary()]);
    const item = await prisma.item.findFirst({
      where: { id, libraryId: library.id, type: "pdf", deletedAt: null },
      include: {
        contentObject: { select: { fileSha256: true } },
        document: { select: { cachedFileId: true } }
      }
    });
    const file = item && await findPdfFile(item, library.accountId);
    if (!file) return new Response(null, { status: 404 });

    const path = pdfStoragePath(file.storageKey);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || !info.size) return new Response(null, { status: 404 });

    const size = info.size;
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "private, no-store, no-transform",
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff"
    });
    const range = request.headers.get("range");
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(end, Number(match[2]));
        } else if (match[2]) {
          start = Math.max(0, size - Number(match[2]));
        }
      }
      if (!match || (!match[1] && !match[2]) || start > end) {
        headers.set("content-range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
    }
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to open PDF" });
  }
}
