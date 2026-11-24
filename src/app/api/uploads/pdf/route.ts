import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { appHref } from "@/app/routes";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentAccount, requireCurrentLibrary } from "@/server/auth";
import { assertEntitlement, canUploadPdf } from "@/server/entitlements";
import { savePdfToLibrary } from "@/server/ingest/pdf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const navigated = request.headers.get("sec-fetch-mode") === "navigate";
  const uploadError = (message: string) => NextResponse.redirect(
    new URL(appHref({ add: "pdf", pdfError: message }), request.url), 303
  );
  try {
    const [account, library] = await Promise.all([requireCurrentAccount(), requireCurrentLibrary()]);
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return navigated ? uploadError("A PDF file is required") : NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    assertEntitlement(canUploadPdf(account, file.size));
    const item = await savePdfToLibrary(library.id, file);
    revalidatePath("/", "layout");
    return navigated ? NextResponse.redirect(new URL(appHref({ item: item.id }), request.url), 303)
      : NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const response = apiErrorResponse(error, { fallbackMessage: "Unable to upload PDF" });
    if (!navigated) return response;
    const { error: message } = await response.json();
    return uploadError(message);
  }
}
