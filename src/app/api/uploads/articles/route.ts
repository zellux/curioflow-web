import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { importArticles } from "@/server/ingest/article-import";

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
    return NextResponse.json(await importArticles(library.id, body?.articles));
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to import articles. You can safely retry this file." });
  }
}
