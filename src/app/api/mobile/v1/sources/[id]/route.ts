import { DELETE as deleteSource, PATCH as updateSource } from "@/app/api/sources/[id]/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? updateSource(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? deleteSource(request, context);
}
