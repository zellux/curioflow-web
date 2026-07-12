import { POST as uploadPdf } from "@/app/api/uploads/pdf/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? uploadPdf(request);
}
