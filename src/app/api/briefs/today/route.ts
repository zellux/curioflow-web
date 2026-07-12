import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { getOrCreateTodayBrief } from "@/server/briefs";

export async function GET() {
  try {
    await requireCurrentLibrary();
    const brief = await getOrCreateTodayBrief();
    return NextResponse.json({ brief });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load brief" });
  }
}
