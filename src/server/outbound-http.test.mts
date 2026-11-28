import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { assertPublicHttpUrl, fetchBytesWithPolicy, fetchTextWithPolicy, isBlockedNetworkAddress, llmAllowsPrivateNetwork, withOutboundHostSlot } from "./outbound-http.ts";

test("outbound policy blocks private, loopback, metadata, and multicast addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1", "fd00::1"]) {
    assert.equal(isBlockedNetworkAddress(address), true, address);
    await assert.rejects(assertPublicHttpUrl(`http://[${address}]/`.replace("[127.0.0.1]", "127.0.0.1")));
  }
});

test("production LLM policy allows explicitly local HTTP origins", async () => {
  assert.equal(await llmAllowsPrivateNetwork("local", "http://127.0.0.1:11434/v1", true), true);
  assert.equal(await llmAllowsPrivateNetwork("local", "http://192.168.1.20:1234/v1", true), true);
  await assert.rejects(llmAllowsPrivateNetwork("local", "file:///etc/passwd", true));
  await assert.rejects(llmAllowsPrivateNetwork("local", "http://user:password@127.0.0.1:11434/v1", true));
});

test("production LLM policy restricts hosted providers to their official HTTPS origins", async () => {
  await assert.rejects(llmAllowsPrivateNetwork("openai", "https://example.com/v1", true));
  await assert.rejects(llmAllowsPrivateNetwork("openai", "http://api.openai.com/v1", true));
  await assert.rejects(llmAllowsPrivateNetwork("openai", "http://192.168.1.20:1234/v1", true));
});

test("production Meta requests allow only the official HTTPS origin with public DNS", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(await llmAllowsPrivateNetwork("meta", "https://api.meta.ai/v1", true), false);
  await assert.rejects(llmAllowsPrivateNetwork("meta", "https://example.com/v1", true));
  await assert.rejects(llmAllowsPrivateNetwork("meta", "http://api.meta.ai/v1", true));
  t.mock.method(dns, "lookup", async () => [{ address: "127.0.0.1", family: 4 }]);
  syncBuiltinESMExports();
  await assert.rejects(llmAllowsPrivateNetwork("meta", "https://api.meta.ai/v1", true), /blocked network address/);
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

test("outbound policy detects a PDF signature across chunks and stops reading non-PDF bodies", async (t) => {
  const encoder = new TextEncoder();
  const options = { requiredBodyPrefix: "%PDF-", allowPrivateNetwork: true, maxBytes: 1024, timeoutMs: 1000 };
  let canceled = false;
  t.mock.method(globalThis, "fetch", async (url: URL) => new Response(new ReadableStream({
    start(controller) {
      if (url.pathname === "/pdf") {
        controller.enqueue(encoder.encode("%PD"));
        controller.enqueue(encoder.encode("F-1.7"));
        controller.close();
      } else {
        controller.enqueue(encoder.encode("<html>"));
      }
    },
    cancel() { canceled = true; }
  })));

  const response = await fetchBytesWithPolicy("https://files.example/pdf", options);
  assert.equal(new TextDecoder().decode(response.bytes), "%PDF-1.7");
  await assert.rejects(fetchBytesWithPolicy("https://files.example/article", options), /expected file signature/);
  assert.equal(canceled, true);
});

test("outbound policy accepts either HTML or a matching body prefix with separate size limits", async (t) => {
  const encoder = new TextEncoder();
  const options = {
    acceptedContentTypes: ["text/html"],
    acceptedBodyPrefixes: [{ prefix: "%PDF-", maxBytes: 64 }],
    allowPrivateNetwork: true,
    maxBytes: 16,
    timeoutMs: 1000
  };
  let canceled = false;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.pathname === "/html") {
      return new Response("<p>short</p>", { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/big-html") {
      return new Response("<p>this html exceeds sixteen bytes</p>", { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/pdf") {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("%PD"));
          controller.enqueue(encoder.encode("F-1.7\n% larger than html limit"));
          controller.close();
        }
      }), { headers: { "content-type": "application/octet-stream" } });
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("not-a-pdf-or-html"));
      },
      cancel() { canceled = true; }
    }), { headers: { "content-type": "image/png" } });
  });

  const html = await fetchBytesWithPolicy("https://files.example/html", options);
  assert.equal(new TextDecoder().decode(html.bytes), "<p>short</p>");

  await assert.rejects(fetchBytesWithPolicy("https://files.example/big-html", options), /size limit/);

  const pdf = await fetchBytesWithPolicy("https://files.example/pdf", options);
  assert.match(new TextDecoder().decode(pdf.bytes), /^%PDF-1\.7/);

  await assert.rejects(fetchBytesWithPolicy("https://files.example/image", options), /unsupported content type/);
  assert.equal(canceled, true);
});

test("outbound policy returns an explicitly accepted error response with its bounded body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>challenge</html>", {
    status: 403,
    headers: {
      "content-type": "text/html",
      "set-cookie": "challenge=accepted; Path=/"
    }
  });
  try {
    const response = await fetchTextWithPolicy("https://challenge.example/", {
      acceptedContentTypes: ["text/html"],
      acceptedStatuses: [403],
      allowPrivateNetwork: true,
      maxBytes: 1024,
      timeoutMs: 1000
    });
    assert.equal(response.status, 403);
    assert.equal(response.text, "<html>challenge</html>");
    assert.match(response.headers.get("set-cookie") ?? "", /challenge=accepted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("outbound policy can include a bounded provider error message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: "Requested context length exceeds the loaded model limit." }
  }), {
    status: 400,
    headers: { "content-type": "application/json" }
  });
  try {
    await assert.rejects(
      fetchTextWithPolicy("https://provider.example/models", {
        acceptedContentTypes: ["application/json"],
        allowPrivateNetwork: true,
        includeResponseBodyInErrors: true,
        maxBytes: 1024,
        timeoutMs: 1000
      }),
      /HTTP 400: Requested context length exceeds the loaded model limit/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
