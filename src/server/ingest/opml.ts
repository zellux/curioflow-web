import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { normalizeUrl, sha256 } from "@/server/ingest/articles";
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
    const result = String(value).trim();
    return result || null;
  }

  return null;
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

async function saveFailedOpmlSource(feed: OpmlFeedImportInput, normalizedUrl: string, error: string) {
  const library = await getCurrentLibrary();
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "rss",
      url: normalizedUrl
    }
  });

  const name = sourceNameFor(feed, normalizedUrl);
  const source = existingSource
    ? await prisma.source.update({
        where: { id: existingSource.id },
        data: {
          name,
          category: feed.category,
          status: existingSource.status === "active" ? "active" : "error",
          lastCheckedAt: new Date()
        }
      })
    : await prisma.source.create({
        data: {
          libraryId: library.id,
          type: "rss",
          name,
          url: normalizedUrl,
          category: feed.category,
          status: "error",
          lastCheckedAt: new Date()
        }
      });

  await prisma.job.create({
    data: {
      libraryId: library.id,
      type: "fetch_source",
      status: "failed",
      error,
      startedAt: new Date(),
      finishedAt: new Date(),
      payloadJson: JSON.stringify({
        sourceId: source.id,
        feedUrl: normalizedUrl,
        importedFrom: "opml",
        sourceFingerprint: sha256(`${normalizedUrl}:opml-placeholder`)
      })
    }
  });

  return source;
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
  let firstItemId: string | null = null;

  for (const feed of normalizedFeeds) {
    try {
      const result = await addRssSourceToCurrentLibrary(feed.xmlUrl, { savedToLibrary: true, category: feed.category });
      imported += 1;
      firstItemId ??= result.items[0]?.id ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import feed";
      await saveFailedOpmlSource(feed, feed.xmlUrl, message);
      imported += 1;
      failed.push({
        url: feed.xmlUrl,
        error: message
      });
    }
  }

  return { imported, failed, firstItemId };
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
