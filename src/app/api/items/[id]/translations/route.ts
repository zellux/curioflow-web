import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { listArticleTranslations, requestArticleTranslation, translationItem } from "@/server/translations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

async function handle(params: Promise<{ id: string }>, translate: boolean) {
  try {
    const { id } = await params;
    const library = await requireCurrentLibrary();
    const item = await translationItem(id, library.id, library.accountId);
    if (!item) return NextResponse.json({ error: "Article not found" }, { status: 404, headers });
    const language = translate ? await requestArticleTranslation(item, library.accountId) : undefined;
    return NextResponse.json({ language, translations: await listArticleTranslations(item) }, { headers });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to translate article" });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(params, false);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(params, true);
}
