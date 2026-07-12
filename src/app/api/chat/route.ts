import { NextResponse } from "next/server";
import { askLibrary } from "@/server/chat";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { question?: string; itemId?: string; threadId?: string } | null;

  if (!body?.question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const thread = await askLibrary(body.question, body.itemId ?? null, body.threadId ?? null);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to answer question" },
      { status: 400 }
    );
  }
}
