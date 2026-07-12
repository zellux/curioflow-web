import { POST as uploadOpml } from "@/app/api/uploads/opml/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? uploadOpml(request);
}
