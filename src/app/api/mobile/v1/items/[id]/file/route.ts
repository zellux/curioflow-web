import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { prisma } from "@/server/db";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

type RouteContext = { params: Promise<{ id: string }> };

const storageRoot = resolve(process.cwd(), "storage");

function storagePath(storageKey: string) {
  const path = resolve(storageRoot, storageKey);
  if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error("Stored file key is invalid");
  return path;
}

function contentDispositionFilename(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Serves the original uploaded file (currently PDFs) for an item in the caller's library,
 * so native clients can render the document itself rather than its extracted text.
 */
export async function GET(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  if (accessError) return accessError;

  const { id } = await context.params;

  try {
    const library = await requireCurrentLibrary();
    const item = await prisma.item.findFirst({
      where: { id, libraryId: library.id, deletedAt: null },
      select: {
        document: {
          select: {
            cachedFile: {
              select: { storageKey: true, mimeType: true, byteSize: true, fileSha256: true, originalFilename: true }
            }
          }
        }
      }
    });
    const file = item?.document?.cachedFile;
    if (!file || file.mimeType !== "application/pdf") {
      return NextResponse.json(
        { code: "file_not_found", message: "This item has no original file.", retryable: false },
        { status: 404 }
      );
    }

    const etag = `"${file.fileSha256}"`;
    const headers = {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Disposition": contentDispositionFilename(file.originalFilename || "document.pdf"),
      "Content-Type": file.mimeType,
      ETag: etag
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }

    const bytes = await readFile(storagePath(file.storageKey));
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: { ...headers, "Content-Length": String(bytes.byteLength) }
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load the original file" });
  }
}
