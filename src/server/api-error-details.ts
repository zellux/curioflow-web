import { EntitlementDeniedError } from "./entitlement-limits.ts";

export type ApiErrorOptions = {
  fallbackMessage: string;
  fallbackStatus?: number;
};

export function apiErrorDetails(error: unknown, options: ApiErrorOptions) {
  if (error instanceof Error && error.name === "AuthRequiredError") {
    return { body: { error: "Authentication required" }, status: 401 };
  }

  if (error instanceof EntitlementDeniedError) {
    return { body: { error: error.message }, status: error.status };
  }

  const message =
    process.env.NODE_ENV === "production"
      ? options.fallbackMessage
      : error instanceof Error
        ? error.message
        : options.fallbackMessage;

  return {
    body: { error: message },
    status: options.fallbackStatus ?? 400
  };
}
