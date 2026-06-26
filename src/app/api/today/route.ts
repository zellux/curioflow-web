import { NextResponse } from "next/server";
import { getDashboardCounts, getInboxItems } from "@/server/items";
import { getOrCreateTodayBrief } from "@/server/briefs";

export async function GET() {
  const [items, counts, brief] = await Promise.all([getInboxItems(), getDashboardCounts(), getOrCreateTodayBrief()]);

  return NextResponse.json({
    counts,
    items,
    brief
  });
}
