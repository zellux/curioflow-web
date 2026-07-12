import { POST as addRssSource } from "@/app/api/sources/rss/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? addRssSource(request);
}
