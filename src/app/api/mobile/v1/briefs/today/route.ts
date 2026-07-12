import { GET as todayBrief } from "@/app/api/briefs/today/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function GET(request: Request) {
  const accessError = await mobileV1AccessGuard();
  void request;
  return accessError ?? todayBrief();
}
