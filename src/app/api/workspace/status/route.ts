import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { getWorkspaceBackgroundState } from "@/server/workspace-background";

export async function GET() {
  try {
    const library = await requireCurrentLibrary();
    return NextResponse.json(await getWorkspaceBackgroundState(library.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load background status" });
  }
}
