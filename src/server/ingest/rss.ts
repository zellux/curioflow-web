import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { normalizeUrl, saveArticleItemToLibrary, sha256 } from "@/server/ingest/articles";

const FEED_TIMEOUT_MS = 10000;

type FeedEntry = {
  title: string | null;
  url: string;
  author: string | null;
  publishedAt: Date | null;
};

type ParsedFeed = {
  title: string;
  siteUrl: string | null;
  entries: FeedEntry[];
};

type FetchedContent = {
  text: string;
  finalUrl: string;
  contentType: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result || null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record["#text"]) ?? text(record.text);
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rssLink(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;

  for (const candidate of asArray(value)) {
    const maybeText = text(candidate);
    if (maybeText) return maybeText;
  }

  return null;
}

function atomLink(value: unknown): string | null {
  for (const candidate of asArray(value)) {
    if (typeof candidate === "string") return candidate.trim() || null;
    if (candidate && typeof candidate === "object") {
      const link = candidate as Record<string, unknown>;
      const rel = text(link.rel);
      const href = text(link.href);
      if (href && (!rel || rel === "alternate")) return href;
    }
  }

  return null;
}

function authorName(value: unknown): string | null {
  const direct = text(value);
  if (direct) return direct;

  for (const candidate of asArray(value)) {
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const name = text(record.name) ?? text(record.email);
      if (name) return name;
    }
  }

  return null;
}

function normalizeEntryUrl(rawUrl: string, feedUrl: string) {
  return normalizeUrl(new URL(rawUrl, feedUrl).toString());
}

async function fetchUrlText(url: string): Promise<FetchedContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html,*/*;q=0.8",
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    if (!response.ok) {
      throw new Error(`URL fetch failed with HTTP ${response.status}`);
    }

    return {
      text: await response.text(),
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") ?? ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssFeed(parsed: Record<string, unknown>, feedUrl: string): ParsedFeed | null {
  const rss = parsed.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) return null;

  const title = text(channel.title) ?? new URL(feedUrl).hostname;
  const siteUrl = rssLink(channel.link);
  const entries = asArray(channel.item)
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const rawUrl = rssLink(item.link) ?? text(item.guid);
      if (!rawUrl) return null;

      return {
        title: text(item.title),
        url: normalizeEntryUrl(rawUrl, feedUrl),
        author: text(item.author) ?? authorName(item.creator),
        publishedAt: parseDate(item.pubDate) ?? parseDate(item.published) ?? parseDate(item.updated)
      };
    })
    .filter((entry): entry is FeedEntry => Boolean(entry));

  return { title, siteUrl, entries };
}

function parseAtomFeed(parsed: Record<string, unknown>, feedUrl: string): ParsedFeed | null {
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (!feed) return null;

  const title = text(feed.title) ?? new URL(feedUrl).hostname;
  const siteUrl = atomLink(feed.link);
  const entries = asArray(feed.entry)
    .map((raw) => {
      const entry = raw as Record<string, unknown>;
      const rawUrl = atomLink(entry.link) ?? text(entry.id);
      if (!rawUrl) return null;

      return {
        title: text(entry.title),
        url: normalizeEntryUrl(rawUrl, feedUrl),
        author: authorName(entry.author),
        publishedAt: parseDate(entry.published) ?? parseDate(entry.updated)
      };
    })
    .filter((entry): entry is FeedEntry => Boolean(entry));

  return { title, siteUrl, entries };
}

function parseFeedXml(xml: string, feedUrl: string) {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    return parseRssFeed(parsed, feedUrl) ?? parseAtomFeed(parsed, feedUrl);
  } catch {
    return null;
  }
}

function looksLikeHtml(content: FetchedContent) {
  return content.contentType.toLowerCase().includes("html") || /<html[\s>]/i.test(content.text);
}

function discoverFeedUrl(html: string, pageUrl: string) {
  const dom = new JSDOM(html, {
    url: pageUrl,
    contentType: "text/html"
  });

  const candidates = Array.from(dom.window.document.querySelectorAll<HTMLLinkElement>("link[rel~='alternate'][href]"))
    .map((link) => {
      const type = link.type.toLowerCase();
      const title = link.title.toLowerCase();
      const href = link.href;
      const score =
        (type.includes("rss") ? 4 : 0) +
        (type.includes("atom") ? 3 : 0) +
        (type.includes("xml") ? 2 : 0) +
        (title.includes("rss") || title.includes("atom") || title.includes("feed") ? 1 : 0);

      return href && score > 0 ? { href, score } : null;
    })
    .filter((candidate): candidate is { href: string; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.href ?? null;
}

function commonFeedCandidates(pageUrl: string) {
  const url = new URL(pageUrl);
  const originCandidates = ["/feed", "/rss.xml", "/atom.xml", "/feed.xml"].map((path) => new URL(path, url.origin).toString());
  const pathBase = url.pathname.endsWith("/") ? url : new URL(`${url.pathname}/`, url.origin);
  const pathCandidates =
    url.pathname === "/"
      ? []
      : ["feed", "rss.xml", "atom.xml", "feed.xml"].map((path) => new URL(path, pathBase).toString());

  return Array.from(new Set([...pathCandidates, ...originCandidates]));
}

async function tryFetchAndParseFeed(candidateUrl: string) {
  try {
    const fetched = await fetchUrlText(normalizeUrl(candidateUrl));
    const normalizedFeedUrl = normalizeUrl(fetched.finalUrl);
    const feed = parseFeedXml(fetched.text, normalizedFeedUrl);
    return feed ? { normalizedFeedUrl, feed, fetched } : null;
  } catch {
    return null;
  }
}

async function fetchAndParseFeed(inputUrl: string) {
  const normalizedInputUrl = normalizeUrl(inputUrl);
  const fetched = await fetchUrlText(normalizedInputUrl);
  const normalizedFetchedUrl = normalizeUrl(fetched.finalUrl);
  let normalizedFeedUrl = normalizedFetchedUrl;
  let feed = parseFeedXml(fetched.text, normalizedFeedUrl);

  if (!feed && looksLikeHtml(fetched)) {
    const discoveredFeedUrl = discoverFeedUrl(fetched.text, normalizedFetchedUrl);
    if (discoveredFeedUrl) {
      const discovered = await tryFetchAndParseFeed(discoveredFeedUrl);
      if (discovered) {
        normalizedFeedUrl = discovered.normalizedFeedUrl;
        feed = discovered.feed;
      }
    }
  }

  if (!feed) {
    for (const candidateUrl of commonFeedCandidates(normalizedFetchedUrl)) {
      const candidate = await tryFetchAndParseFeed(candidateUrl);
      if (candidate) {
        normalizedFeedUrl = candidate.normalizedFeedUrl;
        feed = candidate.feed;
        break;
      }
    }
  }

  if (!feed) {
    throw new Error("Could not find an RSS or Atom feed for this URL");
  }

  if (feed.entries.length === 0) {
    throw new Error("Feed parsed successfully but had no recent articles");
  }

  return { normalizedFeedUrl, feed };
}

export async function previewRssSourceForCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, feed } = await fetchAndParseFeed(inputUrl);
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "rss",
      url: normalizedFeedUrl,
      status: { not: "unsubscribed" }
    },
    include: {
      _count: {
        select: { items: true }
      }
    }
  });

  return {
    normalizedFeedUrl,
    title: feed.title,
    siteUrl: feed.siteUrl,
    totalEntries: feed.entries.length,
    existingSource,
    entries: feed.entries.slice(0, 5).map((entry) => ({
      ...entry,
      publishedAt: entry.publishedAt?.toISOString() ?? null
    }))
  };
}

export async function addRssSourceToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, feed } = await fetchAndParseFeed(inputUrl);
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "rss",
      url: normalizedFeedUrl
    }
  });

  if (existingSource) {
    const source =
      existingSource.status === "unsubscribed"
        ? await prisma.source.update({
            where: { id: existingSource.id },
            data: {
              name: feed.title,
              status: "active",
              lastCheckedAt: new Date()
            }
          })
        : existingSource;

    for (const entry of feed.entries) {
      await saveArticleItemToLibrary({
        libraryId: library.id,
        sourceId: source.id,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        publishedAt: entry.publishedAt,
        jobType: "fetch_source",
        allowDuplicateItem: false
      });
    }

    return {
      source,
      items: await prisma.item.findMany({
        where: { libraryId: library.id, sourceId: source.id },
        orderBy: { createdAt: "desc" }
      }),
      created: existingSource.status === "unsubscribed"
    };
  }

  const source = await prisma.source.create({
    data: {
      libraryId: library.id,
      type: "rss",
      name: feed.title,
      url: normalizedFeedUrl,
      status: "active",
      lastCheckedAt: new Date()
    }
  });

  const job = await prisma.job.create({
    data: {
      libraryId: library.id,
      type: "fetch_source",
      status: "queued",
      payloadJson: JSON.stringify({
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        sourceFingerprint: sha256(`${normalizedFeedUrl}:${feed.entries.length}`)
      })
    }
  });

  try {
    const items = [];
    for (const entry of feed.entries) {
      const item = await saveArticleItemToLibrary({
        libraryId: library.id,
        sourceId: source.id,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        publishedAt: entry.publishedAt,
        jobType: "fetch_source",
        allowDuplicateItem: false
      });
      items.push(item);
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        startedAt: job.createdAt,
        finishedAt: new Date()
      }
    });

    return { source, items, created: true };
  } catch (error) {
    await prisma.$transaction([
      prisma.source.update({
        where: { id: source.id },
        data: { status: "error" }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to load RSS source",
          startedAt: job.createdAt,
          finishedAt: new Date()
        }
      })
    ]);
    throw error;
  }
}
