import assert from "node:assert/strict";
import test from "node:test";
import { signedArticleImageUrl, validArticleImageSignature } from "./article-image-access.ts";

test("image capabilities are bound to the exact image, article and signing key", () => {
  const path = `/api/article-images/89/ab123456789/${"a".repeat(64)}.png`;
  const url = new URL(signedArticleImageUrl(path, "ab123456789", "https://reader.example.com", "test-key"));
  const signature = url.searchParams.get("signature")!;
  assert.equal(url.origin, "https://reader.example.com");
  assert.equal(validArticleImageSignature(path, "ab123456789", signature, "test-key"), true);
  assert.equal(validArticleImageSignature(path.replace(".png", ".jpg"), "ab123456789", signature, "test-key"), false);
  assert.equal(validArticleImageSignature(path, "other-item", signature, "test-key"), false);
  assert.equal(validArticleImageSignature(path, "ab123456789", signature, "rotated-key"), false);
  assert.equal(validArticleImageSignature(path, "ab123456789", "invalid", "test-key"), false);
});

test("the proxy lets image GETs reach their signature/session verifier but protects other APIs", async () => {
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../proxy.ts");
  const path = `/api/article-images/89/ab123456789/${"a".repeat(64)}.png`;
  assert.equal(proxy(new NextRequest(`https://reader.example.com${path}`)).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(new NextRequest(`https://reader.example.com${path}`, { method: "POST" })).status, 401);
  assert.equal(proxy(new NextRequest("https://reader.example.com/api/items")).status, 401);
});
