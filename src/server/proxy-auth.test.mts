import assert from "node:assert/strict";
import test from "node:test";
import { isPublicMobileSessionRequest } from "./proxy-auth.ts";

test("unauthenticated v1 session requests reach the session handlers", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(isPublicMobileSessionRequest("/api/mobile/v1/session", method), true, method);
  }
});

test("legacy session requests retain the same public boundary", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(isPublicMobileSessionRequest("/api/mobile/session", method), true, method);
  }
});

test("other mobile endpoints and unsupported session methods remain protected", () => {
  assert.equal(isPublicMobileSessionRequest("/api/mobile/v1/sync", "POST"), false);
  assert.equal(isPublicMobileSessionRequest("/api/mobile/sync", "GET"), false);
  assert.equal(isPublicMobileSessionRequest("/api/mobile/v1/session/extra", "POST"), false);
  assert.equal(isPublicMobileSessionRequest("/api/mobile/v1/session", "PUT"), false);
});
