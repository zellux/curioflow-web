import { NextResponse } from "next/server";
import { getDashboardCounts, getInboxItems } from "@/server/items";
import { getOrCreateTodayBrief } from "@/server/briefs";

export async function GET() {
  const [inboxPage, counts, brief] = await Promise.all([getInboxItems(), getDashboardCounts(), getOrCreateTodayBrief()]);

  return NextResponse.json({
    counts,
    items: inboxPage.items,
    pagination: {
      page: inboxPage.page,
      pageCount: inboxPage.pageCount,
      pageSize: inboxPage.pageSize,
      total: inboxPage.total
    },
    brief
  });
}
