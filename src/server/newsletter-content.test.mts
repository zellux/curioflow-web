import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeNewsletterContent } from "./newsletter-content.ts";

test("sanitizes newsletter HTML and strips remote images", () => {
  const content = sanitizeNewsletterContent({
    html: `<article><h1>Weekly</h1><script>alert(1)</script><p onclick="bad()">Read <a href="https://example.com/post">this</a>.</p><img src="https://tracker.example/pixel.gif" width="1" height="1"></article>`
  });

  assert.equal(content.text, "WeeklyRead this.");
  assert.doesNotMatch(content.html ?? "", /script|onclick|tracker\.example/i);
  assert.match(content.html ?? "", /https:\/\/example\.com\/post/);
});

test("uses the plain text part when HTML is absent", () => {
  assert.deepEqual(sanitizeNewsletterContent({ text: "Hello\r\nworld" }), {
    html: null,
    text: "Hello\nworld"
  });
});
