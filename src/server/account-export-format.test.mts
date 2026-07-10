import assert from "node:assert/strict";
import test from "node:test";
import { formatAccountExportMarkdown, formatAccountExportOpml } from "./account-export-format.ts";

const payload = {
  generatedAt: "2026-07-09T00:00:00.000Z",
  account: {
    name: "A & B",
    libraries: [{
      name: "Reading",
      sources: [
        { name: 'News & "Notes"', status: "active", type: "rss", url: "https://example.com/feed?a=1&b=2" },
        { name: "Old", status: "unsubscribed", type: "rss", url: "https://example.com/old" },
        { name: "Not a feed", status: "active", type: "web", url: "https://example.com" }
      ],
      items: [{
        title: "An article",
        url: "https://example.com/article",
        author: "Writer",
        document: { text: "  Body text.  " },
        annotations: [{ quote: "  A quote.  ", note: "  My note.  " }]
      }]
    }]
  }
};

test("account export markdown includes readable content and annotations", () => {
  const markdown = formatAccountExportMarkdown(payload);
  assert.match(markdown, /# Curioflow export: A & B/);
  assert.match(markdown, /Body text\./);
  assert.match(markdown, /> A quote\./);
  assert.match(markdown, /My note\./);
});

test("account export OPML includes active feeds and escapes XML attributes", () => {
  const opml = formatAccountExportOpml(payload);
  assert.match(opml, /News &amp; &quot;Notes&quot;/);
  assert.match(opml, /feed\?a=1&amp;b=2/);
  assert.doesNotMatch(opml, /example\.com\/old/);
  assert.doesNotMatch(opml, /Not a feed/);
});
