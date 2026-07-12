import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { previewRssSourceForCurrentLibrary } from "@/server/ingest/rss";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;

  if (!body?.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    await requireCurrentLibrary();
    const preview = await previewRssSourceForCurrentLibrary(body.url);
    return NextResponse.json({ preview });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to preview RSS source" });
  }
}
