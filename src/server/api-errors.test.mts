import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorDetails } from "./api-error-details.ts";
import { EntitlementDeniedError } from "./entitlement-limits.ts";

test("API errors map auth failures to 401", () => {
  const error = new Error("Authentication required");
  error.name = "AuthRequiredError";

  assert.deepEqual(
    apiErrorDetails(error, { fallbackMessage: "Request failed" }),
    { body: { error: "Authentication required" }, status: 401 }
  );
});

test("API errors preserve entitlement denial status and message", () => {
  const error = new EntitlementDeniedError({
    allowed: false,
    code: "source_limit",
    reason: "Source limit reached."
  });

  assert.deepEqual(
    apiErrorDetails(error, { fallbackMessage: "Request failed" }),
    { body: { error: "Source limit reached." }, status: 403 }
  );
});

test("API errors use fallback status for generic failures", () => {
  assert.deepEqual(
    apiErrorDetails(new Error("Bad input"), { fallbackMessage: "Request failed", fallbackStatus: 422 }),
    { body: { error: "Bad input" }, status: 422 }
  );
});
