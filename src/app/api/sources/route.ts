import { NextResponse } from "next/server";
import { getLibrarySources } from "@/server/sources";

export async function GET() {
  const sources = await getLibrarySources();
  return NextResponse.json({ sources });
}
