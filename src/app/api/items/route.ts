import { NextResponse } from "next/server";
import { getInboxItems } from "@/server/items";

export async function GET() {
  const inboxPage = await getInboxItems();
  return NextResponse.json(inboxPage);
}
