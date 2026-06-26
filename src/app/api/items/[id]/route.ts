import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { getItemForReader } from "@/server/items";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ITEM_STATUSES = new Set(["pending", "ready", "failed", "archived"]);
const READ_STATUSES = new Set(["unread", "reading", "done"]);

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const item = await getItemForReader(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    readStatus?: string;
    status?: string;
    readingProgress?: number;
    readingPosition?: Record<string, unknown>;
  } | null;

  if (!body?.readStatus && !body?.status && typeof body?.readingProgress !== "number" && !body?.readingPosition) {
    return NextResponse.json({ error: "readStatus, status, or readingProgress is required" }, { status: 400 });
  }

  if (body.readStatus && !READ_STATUSES.has(body.readStatus)) {
    return NextResponse.json({ error: "readStatus must be unread, reading, or done" }, { status: 400 });
  }

  if (body.status && !ITEM_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "status must be pending, ready, failed, or archived" }, { status: 400 });
  }

  const readingProgress =
    typeof body.readingProgress === "number"
      ? Math.max(0, Math.min(1, body.readingProgress))
      : undefined;
  const readingPositionJson = body.readingPosition ? JSON.stringify(body.readingPosition) : undefined;

  const library = await getCurrentLibrary();
  const result = await prisma.item.updateMany({
    where: { id, libraryId: library.id },
    data: {
      ...(body.readStatus ? { readStatus: body.readStatus } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(readingProgress !== undefined ? { readingProgress } : {}),
      ...(readingPositionJson ? { readingPositionJson } : {}),
      ...(body.readStatus || readingProgress !== undefined ? { lastReadAt: new Date() } : {})
    }
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const item = await getItemForReader(id);
  return NextResponse.json({ item });
}
