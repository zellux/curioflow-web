import { POST as askLibrary } from "@/app/api/chat/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? askLibrary(request);
}
