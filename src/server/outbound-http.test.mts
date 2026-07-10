import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, fetchTextWithPolicy, isBlockedNetworkAddress, llmAllowsPrivateNetwork, withOutboundHostSlot } from "./outbound-http.ts";

test("outbound policy blocks private, loopback, metadata, and multicast addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1", "fd00::1"]) {
    assert.equal(isBlockedNetworkAddress(address), true, address);
    await assert.rejects(assertPublicHttpUrl(`http://[${address}]/`.replace("[127.0.0.1]", "127.0.0.1")));
  }
});

test("Cloud LLM policy allows only official HTTPS provider origins", async () => {
  await assert.rejects(llmAllowsPrivateNetwork("local", "http://127.0.0.1:11434/v1", true));
  await assert.rejects(llmAllowsPrivateNetwork("openai", "https://example.com/v1", true));
});

test("outbound policy rejects credentials and non-HTTP schemes", async () => {
  await assert.rejects(assertPublicHttpUrl("file:///etc/passwd"));
  await assert.rejects(assertPublicHttpUrl("https://user:password@93.184.216.34/"));
});

test("outbound policy caps concurrent work per host", async () => {
  const previous = process.env.CURIOFLOW_OUTBOUND_PER_HOST_CONCURRENCY;
  process.env.CURIOFLOW_OUTBOUND_PER_HOST_CONCURRENCY = "2";
  let active = 0;
  let maximum = 0;
  try {
    await Promise.all(Array.from({ length: 8 }, () => withOutboundHostSlot("example.com", async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    })));
    assert.equal(maximum, 2);
  } finally {
    if (previous === undefined) delete process.env.CURIOFLOW_OUTBOUND_PER_HOST_CONCURRENCY;
    else process.env.CURIOFLOW_OUTBOUND_PER_HOST_CONCURRENCY = previous;
  }
});

test("outbound policy permits an explicitly accepted conditional response without a body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 304,
    headers: { etag: "fixture-etag" }
  });
  try {
    const response = await fetchTextWithPolicy("https://conditional.example/feed.xml", {
      acceptedContentTypes: ["application/rss+xml"],
      acceptedStatuses: [304],
      allowPrivateNetwork: true,
      maxBytes: 1024,
      timeoutMs: 1000
    });
    assert.equal(response.status, 304);
    assert.equal(response.text, "");
    assert.equal(response.headers.get("etag"), "fixture-etag");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
