import { NextResponse } from "next/server";
import { getCurrentLibrary } from "@/server/auth";
import { enqueueLibrarySummaryRegeneration } from "@/server/summaries";

export async function POST() {
  try {
    const library = await getCurrentLibrary();
    const result = await enqueueLibrarySummaryRegeneration({ libraryId: library.id });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to queue summary regeneration" },
      { status: 400 }
    );
  }
}
