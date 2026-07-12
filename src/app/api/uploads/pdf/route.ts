import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount, requireCurrentLibrary } from "@/server/auth";
import { assertEntitlement, canUploadPdf } from "@/server/entitlements";
import { savePdfToLibrary } from "@/server/ingest/pdf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const [account, library] = await Promise.all([requireCurrentAccount(), requireCurrentLibrary()]);
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    assertEntitlement(canUploadPdf(account, file.size));
    const item = await savePdfToLibrary(library.id, file);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to upload PDF" });
  }
}
