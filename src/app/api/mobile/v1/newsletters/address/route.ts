import { GET as getAddress, POST as createAddress } from "@/app/api/newsletters/address/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export async function GET() {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? getAddress();
}

export async function POST() {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? createAddress();
}
