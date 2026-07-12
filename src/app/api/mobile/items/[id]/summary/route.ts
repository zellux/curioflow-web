import { NextResponse } from "next/server";
import { AuthRequiredError } from "@/server/auth";
import { assertEntitlement, canGenerateBrief, EntitlementDeniedError } from "@/server/entitlements";
import { getMobileContext } from "@/server/mobile";
import { regenerateArticleSummary } from "@/server/summaries";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function summaryErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (error instanceof EntitlementDeniedError) {
    return NextResponse.json({ code: error.code, message: error.message, retryable: false }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to regenerate summary" },
    { status: 400 }
  );
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const { account, library } = await getMobileContext();
    assertEntitlement(canGenerateBrief(account));
    await regenerateArticleSummary({ accountId: account.id, libraryId: library.id, itemId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return summaryErrorResponse(error);
  }
}
