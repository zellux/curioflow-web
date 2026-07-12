import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount } from "@/server/auth";
import { assertEntitlement, canAddSource, canImportOpmlFeeds, canUploadOpmlForLimit } from "@/server/entitlements";
import { importOpmlFeeds, parseOpmlFeeds } from "@/server/ingest/opml";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const account = await requireCurrentAccount();
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    assertEntitlement(canUploadOpmlForLimit(file.size));
    const candidates = parseOpmlFeeds(await file.text());

    if (candidates.length === 0) {
      return NextResponse.json({ error: "No feeds found in this OPML file" }, { status: 400 });
    }

    assertEntitlement(canImportOpmlFeeds(account, candidates.length));
    assertEntitlement(await canAddSource(account, { requestedSources: candidates.length }));

    const result = await importOpmlFeeds(candidates);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to import OPML" });
  }
}
