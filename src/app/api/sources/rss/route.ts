import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount } from "@/server/auth";
import { assertEntitlement, canAddSource } from "@/server/entitlements";
import { addRssSourceToCurrentLibrary } from "@/server/ingest/rss";
import { normalizeSourceRefreshInterval } from "@/server/source-schedule";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { autoSaveToLibrary?: boolean; url?: string; refreshIntervalMinutes?: number } | null;

  if (!body?.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (body.autoSaveToLibrary !== undefined && typeof body.autoSaveToLibrary !== "boolean") {
    return NextResponse.json({ error: "autoSaveToLibrary must be a boolean" }, { status: 400 });
  }

  try {
    const account = await requireCurrentAccount();
    assertEntitlement(await canAddSource(account));
    const result = await addRssSourceToCurrentLibrary(body.url, {
      autoSaveToLibrary: body.autoSaveToLibrary,
      refreshIntervalMinutes: normalizeSourceRefreshInterval(body.refreshIntervalMinutes)
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to add RSS source" });
  }
}
