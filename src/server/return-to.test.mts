import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "./return-to.ts";

test("safeReturnTo keeps local application paths", () => {
  assert.equal(safeReturnTo("/home?foo=bar"), "/home?foo=bar");
});

test("safeReturnTo rejects external and login-loop destinations", () => {
  assert.equal(safeReturnTo("https://example.com"), "/home");
  assert.equal(safeReturnTo("//example.com/path"), "/home");
  assert.equal(safeReturnTo("/login?returnTo=/home"), "/home");
});

test("safeReturnTo supports custom fallbacks", () => {
  assert.equal(safeReturnTo("", "/"), "/");
});
