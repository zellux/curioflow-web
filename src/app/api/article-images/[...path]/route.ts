import { prisma } from "@/server/db";
import { articleImageSigningKey, validArticleImageSignature } from "@/server/article-image-access";
import { requireCurrentUser } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { readArticleImage } from "@/server/article-images";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const imagePath = `/api/article-images/${path.join("/")}`;
    const url = new URL(request.url);
    const itemId = url.searchParams.get("item");
    const signature = url.searchParams.get("signature");
    const signed = Boolean(itemId && signature && validArticleImageSignature(imagePath, itemId, signature, await articleImageSigningKey()));
    if ((itemId || signature) && !signed) return new Response(null, { status: 401 });
    const user = signed ? null : await requireCurrentUser();
    const item = await prisma.item.findFirst({
      where: {
        ...(signed ? { id: itemId! } : { library: { accountId: user!.accountId } }),
        deletedAt: null,
        document: { articleHtml: { contains: `src="${imagePath}"` } }
      },
      select: { id: true }
    });
    if (!item) return new Response(null, { status: 404 });
    const image = await readArticleImage(path);
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "content-type": image.contentType,
        "content-length": String(image.bytes.length),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load article image" });
  }
}
