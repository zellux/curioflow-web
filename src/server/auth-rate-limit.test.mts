import assert from "node:assert/strict";
import test from "node:test";
import { requestIpAddress } from "./auth-rate-limit.ts";

test("request IP trusts only the edge-overwritten real IP header", () => {
  const previous = process.env.CURIOFLOW_TRUST_PROXY_HEADERS;
  process.env.CURIOFLOW_TRUST_PROXY_HEADERS = "true";
  try {
    assert.equal(requestIpAddress(new Headers({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "192.0.2.10"
    })), "192.0.2.10");
    assert.equal(requestIpAddress(new Headers({ "x-real-ip": "not-an-ip" })), null);
  } finally {
    if (previous === undefined) delete process.env.CURIOFLOW_TRUST_PROXY_HEADERS;
    else process.env.CURIOFLOW_TRUST_PROXY_HEADERS = previous;
  }
});

test("request IP ignores proxy headers unless trust is explicitly enabled", () => {
  const previous = process.env.CURIOFLOW_TRUST_PROXY_HEADERS;
  delete process.env.CURIOFLOW_TRUST_PROXY_HEADERS;
  try {
    assert.equal(requestIpAddress(new Headers({ "x-real-ip": "192.0.2.10" })), null);
  } finally {
    if (previous !== undefined) process.env.CURIOFLOW_TRUST_PROXY_HEADERS = previous;
  }
});
