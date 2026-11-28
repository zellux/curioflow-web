import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { isTranslationTargetLanguage, listArticleTranslations, requestArticleTranslation, translationItem, translationTargetLanguages, type TranslationTargetLanguage } from "@/server/translations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

async function handle(
  request: Request,
  params: Promise<{ id: string }>,
  translate: boolean,
  targetLanguage?: TranslationTargetLanguage
) {
  try {
    const { id } = await params;
    const library = await requireCurrentLibrary();
    const item = await translationItem(id, library.id, library.accountId);
    if (!item) return NextResponse.json({ error: "Article not found" }, { status: 404, headers });
    const language = translate ? await requestArticleTranslation(item, library.accountId, targetLanguage) : undefined;
    const requestOrigin = new URL(request.url).origin;
    return NextResponse.json(
      { language, translations: await listArticleTranslations(item, { requestOrigin }), targetLanguages: translationTargetLanguages },
      { headers }
    );
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to translate article" });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, false);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!request.body) return handle(request, params, true);
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400, headers });
  }
  if (!("language" in payload)) return handle(request, params, true);
  if (!isTranslationTargetLanguage(payload.language)) {
    return NextResponse.json({ error: "Unsupported translation language" }, { status: 400, headers });
  }
  return handle(request, params, true, payload.language);
}
