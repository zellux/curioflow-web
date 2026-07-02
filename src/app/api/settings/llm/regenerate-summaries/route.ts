import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount, requireCurrentLibrary } from "@/server/auth";
import { assertEntitlement, canGenerateBrief } from "@/server/entitlements";
import { enqueueLibrarySummaryRegeneration } from "@/server/summaries";

export async function POST() {
  try {
    const [account, library] = await Promise.all([requireCurrentAccount(), requireCurrentLibrary()]);
    assertEntitlement(canGenerateBrief(account));
    const result = await enqueueLibrarySummaryRegeneration({ libraryId: library.id });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to queue summary regeneration" });
  }
}
