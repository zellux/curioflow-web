import { POST as saveUrl } from "@/app/api/urls/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? saveUrl(request);
}
