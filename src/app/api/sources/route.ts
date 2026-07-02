import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { getLibrarySourcesForLibrary } from "@/server/sources";

export async function GET() {
  try {
    const library = await requireCurrentLibrary();
    const sources = await getLibrarySourcesForLibrary(library.id);
    return NextResponse.json({ sources });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load sources" });
  }
}
