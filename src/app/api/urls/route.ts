import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { saveUrlToLibrary } from "@/server/ingest/url";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;

  if (!body?.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const library = await requireCurrentLibrary();
    const item = await saveUrlToLibrary(library.id, body.url);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to save URL" });
  }
}
