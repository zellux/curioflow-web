import { NextResponse } from "next/server";
import { AuthRequiredError } from "@/server/auth";
import { assertEntitlement, canUploadPdf, EntitlementDeniedError } from "@/server/entitlements";
import { savePdfToLibrary } from "@/server/ingest/pdf";
import { saveUrlToLibrary } from "@/server/ingest/url";
import { getMobileContext } from "@/server/mobile";

export const runtime = "nodejs";

function shareErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (error instanceof EntitlementDeniedError) {
    return NextResponse.json({ code: error.code, message: error.message, retryable: false }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to save shared item" },
    { status: 400 }
  );
}

export async function POST(request: Request) {
  try {
    const { account, library } = await getMobileContext();
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { url?: string } | null;
      if (!body?.url) {
        return NextResponse.json({ error: "url is required" }, { status: 400 });
      }

      const item = await saveUrlToLibrary(library.id, body.url);
      return NextResponse.json({ item }, { status: 201 });
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    assertEntitlement(canUploadPdf(account, file.size));
    const item = await savePdfToLibrary(library.id, file);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return shareErrorResponse(error);
  }
}
