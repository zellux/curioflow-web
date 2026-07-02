import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { getInboxItems } from "@/server/items";

export async function GET() {
  try {
    await requireCurrentLibrary();
    const inboxPage = await getInboxItems();
    return NextResponse.json(inboxPage);
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load items" });
  }
}
