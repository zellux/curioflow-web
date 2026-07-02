import { NextResponse } from "next/server";
import { getCurrentAccount, getCurrentLibrary } from "@/server/auth";
import { assertEntitlement, canGenerateBrief, EntitlementDeniedError } from "@/server/entitlements";
import { enqueueLibrarySummaryRegeneration } from "@/server/summaries";

export async function POST() {
  try {
    const [account, library] = await Promise.all([getCurrentAccount(), getCurrentLibrary()]);
    assertEntitlement(canGenerateBrief(account));
    const result = await enqueueLibrarySummaryRegeneration({ libraryId: library.id });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to queue summary regeneration" },
      { status: error instanceof EntitlementDeniedError ? error.status : 400 }
    );
  }
}
