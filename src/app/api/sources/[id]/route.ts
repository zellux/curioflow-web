import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { unsubscribeSourceFromLibrary } from "@/server/sources";

const SOURCE_STATUSES = new Set(["active", "paused", "error", "unsubscribed"]);

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: string } | null;

  if (!body?.status || !SOURCE_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "status must be active, paused, error, or unsubscribed" }, { status: 400 });
  }

  try {
    const library = await requireCurrentLibrary();
    const source = await prisma.source.updateMany({
      where: { id, libraryId: library.id },
      data: { status: body.status }
    });

    if (source.count === 0) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const updated = await prisma.source.findFirst({
      where: { id, libraryId: library.id },
      include: {
        _count: {
          select: { entries: true }
        }
      }
    });

    return NextResponse.json({
      source: updated ? { ...updated, _count: { items: updated._count.entries } } : null
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to update source" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { keepItems?: boolean } | null;
  try {
    const library = await requireCurrentLibrary();
    const result = await unsubscribeSourceFromLibrary(library.id, id, { keepItems: body?.keepItems !== false });

    if (!result) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to delete source" });
  }
}
