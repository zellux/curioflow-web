import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { importReadwiseArticles, validateReadwiseArticles } from "@/server/ingest/readwise";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const library = await requireCurrentLibrary();
    // Bound streamed input as well as Content-Length, which clients may omit.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); return NextResponse.json({ error: "Batch too large" }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const rows = validateReadwiseArticles(body.articles);
    return NextResponse.json(await importReadwiseArticles(library.id, rows));
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to import Readwise articles. You can safely retry this file." });
  }
}
