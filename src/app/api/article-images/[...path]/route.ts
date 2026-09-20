import { requireCurrentUser } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { readArticleImage } from "@/server/article-images";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    await requireCurrentUser();
    const { path } = await context.params;
    const image = await readArticleImage(path);
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "content-type": image.contentType,
        "content-length": String(image.bytes.length),
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load article image" });
  }
}
