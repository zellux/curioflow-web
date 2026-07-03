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

test("API errors hide generic failure details in production", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    assert.deepEqual(
      apiErrorDetails(new Error("Internal parser detail"), { fallbackMessage: "Request failed", fallbackStatus: 422 }),
      { body: { error: "Request failed" }, status: 422 }
    );
  } finally {
    env.NODE_ENV = previous;
  }
});
