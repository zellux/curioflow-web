import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { getDashboardCounts, getInboxItems } from "@/server/items";
import { getOrCreateTodayBrief } from "@/server/briefs";

export async function GET() {
  try {
    await requireCurrentLibrary();
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
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load today" });
  }
}
