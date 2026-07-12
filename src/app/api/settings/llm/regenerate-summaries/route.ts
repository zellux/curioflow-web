import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount, requireCurrentLibrary } from "@/server/auth";
import { assertEntitlement, canGenerateBrief } from "@/server/entitlements";
import { enqueueLibrarySummaryRegeneration, type SummaryRegenerationScope } from "@/server/summaries";

export async function POST(request: Request) {
  try {
    const [account, library] = await Promise.all([requireCurrentAccount(), requireCurrentLibrary()]);
    assertEntitlement(canGenerateBrief(account));
    const body = (await request.json().catch(() => ({}))) as { scope?: unknown };
    const scope: SummaryRegenerationScope = body.scope === "missing" ? "missing" : "all";
    const result = await enqueueLibrarySummaryRegeneration({ libraryId: library.id, scope });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to queue summary regeneration" });
  }
}
