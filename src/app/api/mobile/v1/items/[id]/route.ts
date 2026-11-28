import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { getMobileItemPayload } from "@/server/mobile";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await getMobileItemPayload(id, request.url);
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load the article" });
  }
}
