import {
  DELETE as deleteAnnotation,
  PATCH as updateAnnotation,
  POST as createAnnotation
} from "@/app/api/items/[id]/annotations/route";
import { mobileV1AccessGuard } from "@/server/mobile-access-guard";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? createAnnotation(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? updateAnnotation(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  const accessError = await mobileV1AccessGuard();
  return accessError ?? deleteAnnotation(request, context);
}
