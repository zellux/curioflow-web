import { NextResponse } from "next/server";
import { apiErrorDetails, type ApiErrorOptions } from "./api-error-details.ts";

export function apiErrorResponse(error: unknown, options: ApiErrorOptions) {
  if (process.env.NODE_ENV === "production") {
    console.error(error);
  }
  const details = apiErrorDetails(error, options);
  return NextResponse.json(details.body, { status: details.status });
}
