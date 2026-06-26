import { NextResponse } from "next/server";
import { getInboxItems } from "@/server/items";

export async function GET() {
  const items = await getInboxItems();
  return NextResponse.json({ items });
}
