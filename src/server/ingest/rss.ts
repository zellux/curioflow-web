import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { decodeFeedTextEntities } from "@/server/ingest/feed-text";
import { normalizeUrl, saveArticleItemToLibrary, sha256 } from "@/server/ingest/articles";
import { fetchTextWithPolicy } from "@/server/outbound-http";
import { nextSourceFetchAt, sourceFailureNextFetchAt } from "@/server/source-schedule";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";

const FEED_TIMEOUT_MS = 10000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_INITIAL_FEED_ITEMS = 100;

type FeedEntry = {
  title: string | null;
  url: string;
  author: string | null;
  publishedAt: Date | null;
};

type QueuedFeedEntry = Omit<FeedEntry, "publishedAt"> & {
  publishedAt: string | null;
};

type RssSourceJobPayload = {
  sourceId: string;
  feedUrl: string;
  generateSummary?: boolean;
  savedToLibrary?: boolean;
  importedFrom?: string;
  sourceFingerprint?: string;
  totalEntries?: number;
  indexedEntries?: number;
  indexLimit?: number;
  entries?: QueuedFeedEntry[];
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
    const result = decodeFeedTextEntities(String(value)).trim();
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

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(raw.length === 10 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function feedEntryPublishedAt(entry: Record<string, unknown>) {
  const direct =
    parseDate(entry.pubDate) ??
    parseDate(entry.published) ??
    parseDate(entry.updated) ??
    parseDate(entry.date) ??
    parseDate(entry.created) ??
    parseDate(entry.issued) ??
    parseDate(entry.modified) ??
    parseDate(entry.timestamp) ??
    parseDate(entry["dc:date"]) ??
    parseDate(entry["dcterms:issued"]) ??
    parseDate(entry["dcterms:created"]) ??
    parseDate(entry["dcterms:modified"]) ??
    parseDate(entry["prism:publicationDate"]);

  if (direct) return direct;

  for (const [key, value] of Object.entries(entry)) {
    const normalizedKey = key.toLowerCase();
    const looksLikeDate =
      normalizedKey.includes("pubdate") ||
      normalizedKey.includes("publish") ||
      normalizedKey.includes("updated") ||
      normalizedKey.includes("issued") ||
      normalizedKey.includes("created") ||
      normalizedKey.includes("modified") ||
      normalizedKey.includes("timestamp") ||
      normalizedKey.endsWith("date") ||
      normalizedKey.endsWith("time");
    if (!looksLikeDate) continue;

    const date = parseDate(value);
    if (date) return date;
  }

  return null;
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

function recentFeedEntries(entries: FeedEntry[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aTime = a.entry.publishedAt?.getTime();
      const bTime = b.entry.publishedAt?.getTime();

      if (aTime !== undefined && bTime !== undefined && aTime !== bTime) {
        return bTime - aTime;
      }

      if (aTime !== undefined && bTime === undefined) return -1;
      if (aTime === undefined && bTime !== undefined) return 1;
      return a.index - b.index;
    })
    .slice(0, MAX_INITIAL_FEED_ITEMS)
    .map(({ entry }) => entry);
}

function queuedFeedEntry(entry: FeedEntry): QueuedFeedEntry {
  return {
    title: entry.title,
    url: entry.url,
    author: entry.author,
    publishedAt: entry.publishedAt?.toISOString() ?? null
  };
}

function feedEntryFromJob(entry: QueuedFeedEntry): FeedEntry {
  return {
    ...entry,
    publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null
  };
}

function startRssSourceJob(jobId: string) {
  if (!backgroundWorkRunsHere()) return;
  void processRssSourceJob(jobId).catch(async (error) => {
    await recordBackgroundJobFailure(jobId, error);
  });
}

export async function processRssSourceJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.libraryId) {
    throw new Error("RSS source job not found");
  }

  const payload = JSON.parse(job.payloadJson) as RssSourceJobPayload;
  let normalizedFeedUrl = payload.feedUrl;
  let parsedFeed: ParsedFeed | null = null;
  let entries = (payload.entries ?? []).map(feedEntryFromJob);

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await updateJobProgress(job.id, {
      stage: payload.entries ? "queueing_articles" : "fetching_feed",
      sourceId: payload.sourceId,
      feedUrl: payload.feedUrl,
      current: 0,
      total: entries.length
    }, claimed);

    if (!payload.entries) {
      const fetched = await fetchAndParseFeed(payload.feedUrl);
      normalizedFeedUrl = fetched.normalizedFeedUrl;
      parsedFeed = fetched.feed;
      entries = recentFeedEntries(fetched.feed.entries);

      await updateJobProgress(job.id, {
        stage: "queueing_articles",
        sourceId: payload.sourceId,
        feedUrl: normalizedFeedUrl,
        current: 0,
        total: entries.length
      }, claimed);
    }

    for (const [index, entry] of entries.entries()) {
      await saveArticleItemToLibrary({
        libraryId: job.libraryId,
        sourceId: payload.sourceId,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        publishedAt: entry.publishedAt,
        generateSummary: payload.generateSummary ?? true,
        savedToLibrary: payload.savedToLibrary ?? false,
        startIngestJob: false
      });

      const current = index + 1;
      if (current === entries.length || current % 5 === 0) {
        await updateJobProgress(job.id, {
          stage: "queueing_articles",
          sourceId: payload.sourceId,
          current,
          total: entries.length,
          latestTitle: entry.title
        }, claimed);
      }
    }

    const sourceSchedule = await prisma.source.findUnique({
      where: { id: payload.sourceId },
      select: { refreshIntervalMinutes: true }
    });
    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.source.update({
        where: { id: payload.sourceId },
        data: {
          ...(parsedFeed ? { name: parsedFeed.title, url: normalizedFeedUrl } : {}),
          status: "active",
          lastCheckedAt: new Date(),
          consecutiveFailures: 0,
          nextFetchAt: nextSourceFetchAt(sourceSchedule?.refreshIntervalMinutes ?? 60)
        }
      });
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          nextRunAt: null,
          progressJson: serializeJobProgress({
            stage: "succeeded",
            sourceId: payload.sourceId,
            current: entries.length,
            total: entries.length
          }),
          payloadJson: JSON.stringify({
            ...payload,
            feedUrl: normalizedFeedUrl,
            sourceFingerprint: parsedFeed ? sha256(`${normalizedFeedUrl}:${parsedFeed.entries.length}`) : payload.sourceFingerprint,
            totalEntries: parsedFeed?.entries.length ?? payload.totalEntries,
            indexedEntries: entries.length,
            indexLimit: MAX_INITIAL_FEED_ITEMS,
            entries: payload.entries ?? entries.map(queuedFeedEntry),
            processedEntries: entries.length
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
  } catch (error) {
    const source = await prisma.source.findUnique({
      where: { id: payload.sourceId },
      select: { consecutiveFailures: true }
    });
    const consecutiveFailures = (source?.consecutiveFailures ?? 0) + 1;
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status === "ignored") return;
    await prisma.source.update({
        where: { id: payload.sourceId },
        data: {
          status: "error",
          consecutiveFailures: { increment: 1 },
          nextFetchAt: sourceFailureNextFetchAt(consecutiveFailures)
        }
      });
    return;
  }
}

async function fetchUrlText(url: string): Promise<FetchedContent> {
  const response = await fetchTextWithPolicy(url, {
    acceptedContentTypes: ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/html"],
    headers: {
      accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html",
      "user-agent": "CurioflowBot/0.1 (+https://curioflow.net)"
    },
    maxBytes: MAX_FEED_BYTES,
    timeoutMs: FEED_TIMEOUT_MS
  });
  return { text: response.text, finalUrl: response.finalUrl, contentType: response.contentType };
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
        publishedAt: feedEntryPublishedAt(item)
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
        publishedAt: feedEntryPublishedAt(entry)
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

function normalizedSourceCategory(category?: string | null) {
  const trimmed = category?.trim();
  return trimmed || null;
}

function sourceNameFromUrl(inputUrl: string) {
  try {
    return new URL(inputUrl).hostname.replace(/^www\./, "");
  } catch {
    return inputUrl;
  }
}

export async function enqueueRssSourceImportForCurrentLibrary(
  inputUrl: string,
  options: {
    name?: string | null;
    savedToLibrary?: boolean;
    category?: string | null;
    importedFrom?: string;
  } = {}
) {
  const library = await getCurrentLibrary();
  const normalizedFeedUrl = normalizeUrl(inputUrl);
  const category = normalizedSourceCategory(options.category);
  const name = options.name?.trim() || sourceNameFromUrl(normalizedFeedUrl);
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "rss",
      url: normalizedFeedUrl
    }
  });

  const source = existingSource
    ? await prisma.source.update({
        where: { id: existingSource.id },
        data: {
          name,
          ...(category ? { category } : {}),
          status: "importing"
        }
      })
    : await prisma.source.create({
        data: {
          libraryId: library.id,
          type: "rss",
          name,
          url: normalizedFeedUrl,
          category,
          status: "importing"
        }
      });

  const job = await prisma.job.create({
    data: {
      libraryId: library.id,
      type: "fetch_source",
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        sourceId: source.id,
        feedUrl: normalizedFeedUrl
      }),
      payloadJson: JSON.stringify({
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        importedFrom: options.importedFrom,
        sourceFingerprint: sha256(`${normalizedFeedUrl}:queued`),
        generateSummary: true,
        savedToLibrary: options.savedToLibrary ?? false
      })
    }
  });

  startRssSourceJob(job.id);
  return { source, job, created: !existingSource || existingSource.status === "unsubscribed" };
}

export async function addRssSourceToCurrentLibrary(
  inputUrl: string,
  options: { savedToLibrary?: boolean; category?: string | null } = {}
) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, feed } = await fetchAndParseFeed(inputUrl);
  const entriesToIndex = recentFeedEntries(feed.entries);
  const category = normalizedSourceCategory(options.category);
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "rss",
      url: normalizedFeedUrl
    }
  });

  if (existingSource) {
    const shouldUpdateSource = existingSource.status === "unsubscribed" || Boolean(category && existingSource.category !== category);
    const source =
      shouldUpdateSource
        ? await prisma.source.update({
            where: { id: existingSource.id },
            data: {
              name: feed.title,
              ...(existingSource.status === "unsubscribed" ? { status: "active" } : {}),
              lastCheckedAt: new Date(),
              ...(category ? { category } : {})
            }
          })
        : existingSource;

    const job = await prisma.job.create({
      data: {
        libraryId: library.id,
        type: "fetch_source",
        status: "queued",
        progressJson: serializeJobProgress({
          stage: "queued",
          sourceId: source.id,
          feedUrl: normalizedFeedUrl,
          current: 0,
          total: entriesToIndex.length
        }),
        payloadJson: JSON.stringify({
          sourceId: source.id,
          feedUrl: normalizedFeedUrl,
          sourceFingerprint: sha256(`${normalizedFeedUrl}:${feed.entries.length}`),
          totalEntries: feed.entries.length,
          indexedEntries: entriesToIndex.length,
          indexLimit: MAX_INITIAL_FEED_ITEMS,
          generateSummary: true,
          savedToLibrary: options.savedToLibrary ?? false,
          entries: entriesToIndex.map(queuedFeedEntry)
        })
      }
    });
    startRssSourceJob(job.id);

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
      category,
      status: "active",
      lastCheckedAt: new Date()
    }
  });

  const job = await prisma.job.create({
    data: {
      libraryId: library.id,
      type: "fetch_source",
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        current: 0,
        total: entriesToIndex.length
      }),
      payloadJson: JSON.stringify({
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        sourceFingerprint: sha256(`${normalizedFeedUrl}:${feed.entries.length}`),
        totalEntries: feed.entries.length,
        indexedEntries: entriesToIndex.length,
        indexLimit: MAX_INITIAL_FEED_ITEMS,
        generateSummary: true,
        savedToLibrary: options.savedToLibrary ?? false,
        entries: entriesToIndex.map(queuedFeedEntry)
      })
    }
  });

  startRssSourceJob(job.id);
  return { source, items: [], created: true };
}
