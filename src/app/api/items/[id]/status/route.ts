import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { readerRevision } from "@/server/reader-revision";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const library = await requireCurrentLibrary();
    const item = await prisma.item.findFirst({
      where: {
        id, libraryId: library.id, deletedAt: null,
        OR: [
          { documentId: null },
          { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }
        ]
      },
      select: {
        status: true, title: true,
        document: { select: { id: true, contentHash: true, metadataJson: true } }
      }
    });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return NextResponse.json({ revision: readerRevision(item) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load article status" });
  }
}
