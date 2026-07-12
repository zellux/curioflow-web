import { POST as addPodcastSource } from "@/app/api/sources/podcast/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? addPodcastSource(request);
}
