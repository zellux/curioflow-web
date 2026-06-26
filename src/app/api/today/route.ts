import { NextResponse } from "next/server";
import { getDashboardCounts, getInboxItems } from "@/server/items";

export async function GET() {
  const [items, counts] = await Promise.all([getInboxItems(), getDashboardCounts()]);

  return NextResponse.json({
    counts,
    items,
    brief: {
      status: "reserved",
      title: "Daily brief",
      summary: "Brief generation is reserved for the next phase."
    }
  });
}
