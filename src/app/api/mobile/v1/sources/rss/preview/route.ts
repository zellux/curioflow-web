import { POST as previewRssSource } from "@/app/api/sources/rss/preview/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? previewRssSource(request);
}
