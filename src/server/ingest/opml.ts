import { XMLParser } from "fast-xml-parser";
import { decodeFeedTextEntities } from "@/server/ingest/feed-text";
import { normalizeUrl } from "@/server/ingest/articles";
import { enqueueRssSourceImportForCurrentLibrary } from "@/server/ingest/rss";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true
});

export type OpmlFeedCandidate = {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  category: string | null;
};

export type OpmlImportResult = {
  imported: number;
  failed: Array<{ url: string; error: string }>;
  firstItemId: string | null;
};

type OpmlFeedImportInput = {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  category: string | null;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const result = decodeFeedTextEntities(String(value)).trim();
    return result || null;
  }

  return null;
}

function normalizedCategory(value: unknown): string | null {
  const category = text(value);
  return category || null;
}

function folderCategory(outline: Record<string, unknown>, inheritedCategory: string | null, depth: number) {
  const title = text(outline.title) ?? text(outline.text);
  if (!title) return inheritedCategory;

  const genericRootLabels = new Set(["feeds", "rss", "subscriptions", "my feeds"]);
  if (depth === 0 && genericRootLabels.has(title.toLowerCase())) return inheritedCategory;

  return title;
}

function normalizeOpmlFeedUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Feed URL is empty");

  if (/^feed:https?:\/\//i.test(trimmed)) {
    return normalizeUrl(trimmed.replace(/^feed:/i, ""));
  }

  if (/^feed:\/\/https?:\/\//i.test(trimmed)) {
    return normalizeUrl(trimmed.replace(/^feed:\/\//i, ""));
  }

  if (/^feed:\/\//i.test(trimmed)) {
    const feedUrl = new URL(trimmed);
    return normalizeUrl(`https://${feedUrl.host}${feedUrl.pathname}${feedUrl.search}`);
  }

  if (/^\/\//.test(trimmed)) {
    return normalizeUrl(`https:${trimmed}`);
  }

  return normalizeUrl(trimmed);
}

function collectOutlines(value: unknown, category: string | null, feeds: OpmlFeedCandidate[], depth = 0) {
  for (const candidate of asArray(value)) {
    if (!candidate || typeof candidate !== "object") continue;

    const outline = candidate as Record<string, unknown>;
    const xmlUrl = text(outline.xmlUrl);
    const title = text(outline.title) ?? text(outline.text) ?? xmlUrl;
    const outlineCategory = normalizedCategory(outline.category);
    const nextCategory = xmlUrl ? category : folderCategory(outline, category, depth);

    if (xmlUrl && title) {
      feeds.push({
        title,
        xmlUrl,
        htmlUrl: text(outline.htmlUrl),
        category: outlineCategory ?? category
      });
    }

    collectOutlines(outline.outline, nextCategory, feeds, depth + 1);
  }
}

export function parseOpmlFeeds(opmlXml: string) {
  const parsed = parser.parse(opmlXml) as Record<string, unknown>;
  const body = (parsed.opml as Record<string, unknown> | undefined)?.body as Record<string, unknown> | undefined;
  const feeds: OpmlFeedCandidate[] = [];

  collectOutlines(body?.outline, null, feeds);

  const seen = new Set<string>();
  return feeds.filter((feed) => {
    try {
      const normalized = normalizeOpmlFeedUrl(feed.xmlUrl);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      feed.xmlUrl = normalized;
      return true;
    } catch {
      return false;
    }
  });
}

function sourceNameFor(feed: OpmlFeedImportInput, normalizedUrl: string) {
  const title = feed.title.trim();
  if (title && title !== feed.xmlUrl) return title;

  try {
    return new URL(feed.htmlUrl || normalizedUrl).hostname.replace(/^www\./, "");
  } catch {
    return normalizedUrl;
  }
}

export async function importOpmlFeeds(feeds: OpmlFeedImportInput[]): Promise<OpmlImportResult> {
  const failed: OpmlImportResult["failed"] = [];
  const normalizedFeeds = Array.from(
    feeds
      .reduce((map, feed) => {
        try {
          const normalizedUrl = normalizeOpmlFeedUrl(feed.xmlUrl);
          if (!map.has(normalizedUrl)) {
            map.set(normalizedUrl, {
              ...feed,
              xmlUrl: normalizedUrl
            });
          }
        } catch (error) {
          failed.push({
            url: feed.xmlUrl,
            error: error instanceof Error ? error.message : "Invalid feed URL"
          });
        }
        return map;
      }, new Map<string, OpmlFeedImportInput>())
      .values()
  ).slice(0, 100);

  let imported = 0;

  for (const feed of normalizedFeeds) {
    try {
      await enqueueRssSourceImportForCurrentLibrary(feed.xmlUrl, {
        name: sourceNameFor(feed, feed.xmlUrl),
        savedToLibrary: false,
        category: feed.category,
        importedFrom: "opml"
      });
      imported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import feed";
      failed.push({
        url: feed.xmlUrl,
        error: message
      });
    }
  }

  return { imported, failed, firstItemId: null };
}

export async function importOpmlFeedUrls(feedUrls: string[]) {
  return importOpmlFeeds(
    feedUrls.map((url) => ({
      title: url,
      xmlUrl: url,
      htmlUrl: null,
      category: null
    }))
  );
}
