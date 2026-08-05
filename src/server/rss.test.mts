import assert from "node:assert/strict";
import test from "node:test";
import { discoverFeedUrl, fetchAndParseFeed, parseFeedXml } from "./ingest/rss.ts";

const RSS_2 = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>RSS 2 Example</title>
    <link>https://feeds.example/</link>
    <item>
      <guid>rss-2-entry</guid>
      <title>RSS 2 Entry</title>
      <link>https://feeds.example/rss-2</link>
      <pubDate>Tue, 04 Aug 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_1 = `<?xml version="1.0"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns="http://purl.org/rss/1.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://feeds.example/rss-1">
    <title>RSS 1 Example</title>
    <link>https://feeds.example/</link>
  </channel>
  <item rdf:about="https://feeds.example/rss-1-entry">
    <title>RSS 1 Entry</title>
    <link>https://feeds.example/rss-1-entry</link>
    <dc:creator>RSS 1 Author</dc:creator>
    <dc:date>2026-08-04T12:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

const ATOM_1 = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <link rel="alternate" href="https://feeds.example/" />
  <entry>
    <id>atom-entry</id>
    <title>Atom Entry</title>
    <link rel="alternate" href="https://feeds.example/atom-entry" />
    <updated>2026-08-04T12:00:00Z</updated>
    <author><name>Atom Author</name></author>
  </entry>
</feed>`;

function fetched(input: {
  contentType: string;
  finalUrl: string;
  setCookies?: string[];
  status?: number;
  text: string;
}) {
  return {
    contentType: input.contentType,
    finalUrl: input.finalUrl,
    httpEtag: null,
    httpLastModified: null,
    setCookies: input.setCookies ?? [],
    status: input.status ?? 200,
    text: input.text
  };
}

test("RSS parser supports RSS 2.0, RSS 1.0 RDF, and Atom 1.0", () => {
  const rss2 = parseFeedXml(RSS_2, "https://feeds.example/feed/");
  const rss1 = parseFeedXml(RSS_1, "https://feeds.example/feed/rss/");
  const atom = parseFeedXml(ATOM_1, "https://feeds.example/feed/atom/");

  assert.equal(rss2?.title, "RSS 2 Example");
  assert.equal(rss2?.entries[0]?.entryKey, "rss-2-entry");
  assert.equal(rss1?.title, "RSS 1 Example");
  assert.equal(rss1?.entries[0]?.entryKey, "https://feeds.example/rss-1-entry");
  assert.equal(rss1?.entries[0]?.author, "RSS 1 Author");
  assert.equal(atom?.title, "Atom Example");
  assert.equal(atom?.entries[0]?.entryKey, "atom-entry");
  assert.equal(atom?.entries[0]?.author, "Atom Author");
});

test("HTML autodiscovery recognizes RSS 2.0, RSS 1.0 RDF, and Atom declarations", () => {
  const rss2Html = `<html><head>
    <link rel="alternate" type="application/rss+xml" title="RSS 2.0" href="/feed/" />
  </head></html>`;
  const rss1Html = `<html><head>
    <link rel="alternate" type="application/rdf+xml" title="RSS 1.0" href="/feed/rss/" />
  </head></html>`;
  const atomHtml = `<html><head>
    <link rel="alternate" type="application/atom+xml" title="Atom 1.0" href="/feed/atom/" />
  </head></html>`;
  const allFormatsHtml = `<html><head>
    <link rel="alternate" type="application/rss+xml" title="RSS 2.0" href="/feed/" />
    <link rel="alternate" type="application/rdf+xml" title="RSS 1.0" href="/feed/rss/" />
    <link rel="alternate" type="application/atom+xml" title="Atom 1.0" href="/feed/atom/" />
  </head></html>`;

  assert.equal(discoverFeedUrl(rss2Html, "https://feeds.example/"), "https://feeds.example/feed/");
  assert.equal(discoverFeedUrl(rss1Html, "https://feeds.example/"), "https://feeds.example/feed/rss/");
  assert.equal(discoverFeedUrl(atomHtml, "https://feeds.example/"), "https://feeds.example/feed/atom/");
  assert.equal(discoverFeedUrl(allFormatsHtml, "https://feeds.example/"), "https://feeds.example/feed/");
});

test("feed discovery replays a 403 challenge once with same-origin cookies", async () => {
  const calls: Array<{ options: Record<string, unknown>; url: string }> = [];
  const fetcher = async (url: string, options: Record<string, unknown> = {}) => {
    calls.push({ url, options });
    if (url === "https://feeds.example/") {
      const headers = options.headers as Record<string, string> | undefined;
      if (!headers?.cookie) {
        return fetched({
          contentType: "text/html",
          finalUrl: url,
          setCookies: ["challenge=accepted; Path=/", "session=ready; HttpOnly; Path=/"],
          status: 403,
          text: "<script>window.location.href='/';</script>"
        });
      }
      return fetched({
        contentType: "text/html",
        finalUrl: url,
        text: '<link rel="alternate" type="application/rss+xml" href="/feed/" />'
      });
    }
    if (url === "https://feeds.example/feed") {
      return fetched({ contentType: "application/rss+xml", finalUrl: url, text: RSS_2 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchAndParseFeed("https://feeds.example/", {}, fetcher);

  assert.equal(result.normalizedFeedUrl, "https://feeds.example/feed");
  assert.equal(result.feed?.entries.length, 1);
  assert.equal((calls[1]?.options.headers as Record<string, string>).cookie, "challenge=accepted; session=ready");
  assert.equal(calls[2]?.options.headers, undefined);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://feeds.example/",
    "https://feeds.example/",
    "https://feeds.example/feed"
  ]);
});

test("feed discovery probes common paths when an HTML origin remains forbidden", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url === "https://fallback.example/") {
      return fetched({
        contentType: "text/html",
        finalUrl: url,
        status: 403,
        text: "Forbidden"
      });
    }
    if (url === "https://fallback.example/feed") {
      return fetched({ contentType: "application/rss+xml", finalUrl: url, text: RSS_2 });
    }
    throw new Error(`Unavailable: ${url}`);
  };

  const result = await fetchAndParseFeed("https://fallback.example/", {}, fetcher);

  assert.equal(result.normalizedFeedUrl, "https://fallback.example/feed");
  assert.deepEqual(calls, ["https://fallback.example/", "https://fallback.example/feed"]);
});
