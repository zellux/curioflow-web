import { XMLParser } from "fast-xml-parser";
import { normalizeUrl } from "@/server/ingest/articles";
import { addRssSourceToCurrentLibrary } from "@/server/ingest/rss";

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

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result || null;
  }

  return null;
}

function collectOutlines(value: unknown, category: string | null, feeds: OpmlFeedCandidate[]) {
  for (const candidate of asArray(value)) {
    if (!candidate || typeof candidate !== "object") continue;

    const outline = candidate as Record<string, unknown>;
    const xmlUrl = text(outline.xmlUrl);
    const title = text(outline.title) ?? text(outline.text) ?? xmlUrl;
    const nextCategory = xmlUrl ? category : text(outline.title) ?? text(outline.text) ?? category;

    if (xmlUrl && title) {
      feeds.push({
        title,
        xmlUrl,
        htmlUrl: text(outline.htmlUrl),
        category
      });
    }

    collectOutlines(outline.outline, nextCategory, feeds);
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
      const normalized = normalizeUrl(feed.xmlUrl);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      feed.xmlUrl = normalized;
      return true;
    } catch {
      return false;
    }
  });
}

export async function importOpmlFeedUrls(feedUrls: string[]): Promise<OpmlImportResult> {
  const normalizedUrls = Array.from(
    new Set(
      feedUrls
        .map((url) => {
          try {
            return normalizeUrl(url);
          } catch {
            return null;
          }
        })
        .filter((url): url is string => Boolean(url))
    )
  ).slice(0, 100);

  const failed: OpmlImportResult["failed"] = [];
  let imported = 0;
  let firstItemId: string | null = null;

  for (const url of normalizedUrls) {
    try {
      const result = await addRssSourceToCurrentLibrary(url, { savedToLibrary: true });
      imported += 1;
      firstItemId ??= result.items[0]?.id ?? null;
    } catch (error) {
      failed.push({
        url,
        error: error instanceof Error ? error.message : "Unable to import feed"
      });
    }
  }

  return { imported, failed, firstItemId };
}
