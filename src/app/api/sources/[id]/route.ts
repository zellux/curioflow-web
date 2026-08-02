import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary } from "@/server/auth";
import { unsubscribeSourceFromLibrary } from "@/server/sources";

const SOURCE_STATUSES = new Set(["active", "paused", "error", "unsubscribed", "blocked", "provisional"]);

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: string; status?: string } | null;
  const name = body?.name?.trim();

  if (!body || (!body.status && !name)) return NextResponse.json({ error: "name or status is required" }, { status: 400 });
  if (body.status && !SOURCE_STATUSES.has(body.status)) return NextResponse.json({ error: "invalid source status" }, { status: 400 });
  if (body.name !== undefined && (!name || name.length > 120)) return NextResponse.json({ error: "name must be between 1 and 120 characters" }, { status: 400 });

  try {
    const library = await requireCurrentLibrary();
    const existing = await prisma.source.findFirst({ where: { id, libraryId: library.id } });
    if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    if ((body.status === "blocked" || body.status === "provisional") && existing.type !== "newsletter") {
      return NextResponse.json({ error: "status is only valid for newsletter sources" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.source.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(body.status ? { status: body.status } : {})
        }
      }),
      ...(existing.type === "newsletter" && body.status === "blocked"
        ? [prisma.newsletterIdentity.updateMany({ where: { sourceId: id }, data: { blockedAt: new Date() } })]
        : []),
      ...(existing.type === "newsletter" && body.status === "active"
        ? [prisma.newsletterIdentity.updateMany({ where: { sourceId: id }, data: { blockedAt: null } })]
        : [])
    ]);

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
