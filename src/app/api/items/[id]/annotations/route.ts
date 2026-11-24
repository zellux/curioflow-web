import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary, requireCurrentUser } from "@/server/auth";
import { pdfLocation } from "@/app/pdf-location";
import { attachLegacyPdfDocument } from "@/server/ingest/pdf";
import { prisma } from "@/server/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    color?: string;
    quote?: string;
    note?: string;
    location?: Record<string, unknown>;
  } | null;
  const quote = typeof body?.quote === "string" ? body.quote.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const color = typeof body?.color === "string" ? body.color.trim() : "";
  const pdf = pdfLocation(body?.location);
  if (typeof body?.location?.type === "string" && body.location.type.startsWith("pdf-") && !pdf) {
    return NextResponse.json({ error: "Invalid PDF annotation location" }, { status: 400 });
  }
  if (pdf?.type === "pdf-text-underline" && !quote) {
    return NextResponse.json({ error: "Selected PDF text is required" }, { status: 400 });
  }
  if (!quote && !pdf) {
    return NextResponse.json({ error: "A quote or PDF location is required" }, { status: 400 });
  }

  try {
    const [library, user] = await Promise.all([requireCurrentLibrary(), requireCurrentUser()]);
    const item = await prisma.item.findFirst({
      where: { id, libraryId: library.id, deletedAt: null },
      include: { contentObject: { select: { fileSha256: true } } }
    });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (pdf && (item.type !== "pdf" || (pdf.type === "pdf-note" && !note))) {
      return NextResponse.json({ error: "Invalid PDF annotation" }, { status: 400 });
    }

    const documentId = item.documentId ?? (pdf ? await attachLegacyPdfDocument(item, library.accountId) : null);
    if (!documentId) return NextResponse.json({ error: "Item has no document" }, { status: 404 });

    const annotation = await prisma.annotation.create({
      data: {
        userId: user.id,
        itemId: item.id,
        documentId,
        quote: quote.slice(0, 4000),
        note: note || null,
        locationJson: JSON.stringify(pdf ?? {
          type: "highlight",
          color: color || "#F3D27A",
          ...(body?.location ?? {})
        })
      }
    });

    return NextResponse.json({ annotation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to create annotation" });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    annotationId?: string;
    note?: string;
  } | null;
  const annotationId = body?.annotationId?.trim();
  const note = body?.note?.trim() ?? "";

  if (!annotationId) {
    return NextResponse.json({ error: "annotationId is required" }, { status: 400 });
  }

  try {
    const [library, user] = await Promise.all([requireCurrentLibrary(), requireCurrentUser()]);
    const item = await prisma.item.findFirst({
      where: { id, libraryId: library.id, deletedAt: null },
      select: { id: true }
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const result = await prisma.annotation.updateMany({
      where: {
        id: annotationId,
        itemId: item.id,
        userId: user.id
      },
      data: {
        note: note || null
      }
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to update annotation" });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    annotationId?: string;
  } | null;
  const annotationId = body?.annotationId?.trim();

  if (!annotationId) {
    return NextResponse.json({ error: "annotationId is required" }, { status: 400 });
  }

  try {
    const [library, user] = await Promise.all([requireCurrentLibrary(), requireCurrentUser()]);
    const item = await prisma.item.findFirst({
      where: { id, libraryId: library.id, deletedAt: null },
      select: { id: true }
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const result = await prisma.annotation.deleteMany({
      where: {
        id: annotationId,
        itemId: item.id,
        userId: user.id
      }
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to delete annotation" });
  }
}
