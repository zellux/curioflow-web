import type { NextResponse } from "next/server";
import { apiErrorResponse } from "./api-errors.ts";
import { requireCurrentAccount } from "./auth.ts";

export async function mobileAccessGuard(request: Request): Promise<NextResponse | null> {
  if (request.headers.get("x-curioflow-client") !== "ios") return null;
  return mobileV1AccessGuard();
}

export async function mobileV1AccessGuard(): Promise<NextResponse | null> {
  try {
    await requireCurrentAccount();
    return null;
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Mobile access is unavailable", fallbackStatus: 401 });
  }
}
