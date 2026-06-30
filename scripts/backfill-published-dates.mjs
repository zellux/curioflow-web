import { PrismaClient } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";

const prisma = new PrismaClient();
const FETCH_TIMEOUT_MS = 12000;
const ARTICLE_CONCURRENCY = Number(argValue("concurrency") ?? 6);
const SHOULD_SCAN_ARTICLE_PAGES = process.argv.includes("--article-pages");
const SHOULD_SCAN_STORED_ARTICLES = !process.argv.includes("--skip-stored-articles");
const SHOULD_SCAN_FEEDS = !process.argv.includes("--skip-feeds");
const SHOULD_OVERWRITE_FEED_DATES = process.argv.includes("--overwrite-feed-dates");
const SHOULD_OVERWRITE_STORED_STRUCTURED_DATES = process.argv.includes("--overwrite-stored-structured-dates");
const DRY_RUN = process.argv.includes("--dry-run");
const TEXT_DATE_UPDATE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true
});

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result || null;
  }

  if (value && typeof value === "object") {
    return text(value["#text"]) ?? text(value.text);
  }

  return null;
}

function parseDate(value) {
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

function dateFromParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour ?? 0);
  const numericMinute = Number(minute ?? 0);
  const numericSecond = Number(second ?? 0);

  if (numericYear < 1990 || numericYear > 2035 || numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) {
    return null;
  }

  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay, numericHour, numericMinute, numericSecond));
  return Number.isNaN(date.getTime()) ? null : date;
}

const MONTHS = new Map(
  Object.entries({
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  })
);

function monthNumber(value) {
  return MONTHS.get(value.replace(".", "").toLowerCase()) ?? null;
}

function articleTextDate(textValue, { allowBareEnglish = false } = {}) {
  const haystack = text(textValue)?.replace(/\s+/g, " ").slice(0, 5000);
  if (!haystack) return null;

  const labeledIso = haystack.match(
    /(?:发表于|发布于|發表於|发布日期|發布日期|时间|時間|date|published|posted|updated)\s*[：:]?\s*(\d{4})[\-.\/年](\d{1,2})[\-.\/月](\d{1,2})日?(?:[ T　\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i
  );
  if (labeledIso) {
    const date = dateFromParts(labeledIso[1], labeledIso[2], labeledIso[3], labeledIso[4], labeledIso[5], labeledIso[6]);
    if (date) return date;
  }

  const cjkDate = haystack.match(/(?:本文)?\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:首发|发布|发表|更新|\s)/);
  if (cjkDate) {
    const date = dateFromParts(cjkDate[1], cjkDate[2], cjkDate[3]);
    if (date) return date;
  }

  const englishPrefix = allowBareEnglish ? "(?:Posted|Published|Updated|Written)?\\s*(?:on\\s+)?" : "(?:(?:Posted|Published|Updated|Written)\\s*(?:on\\s+)?|on\\s+)";
  const englishMonth = haystack.match(
    new RegExp(
      `${englishPrefix}(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?:\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?)?`,
      "i"
    )
  );
  if (englishMonth) {
    const month = monthNumber(englishMonth[1]);
    let hour = Number(englishMonth[4] ?? 0);
    const meridiem = englishMonth[6]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const date = month ? dateFromParts(englishMonth[3], month, englishMonth[2], hour, englishMonth[5] ?? 0) : null;
    if (date) return date;
  }

  const dayMonth = haystack.match(
    new RegExp(
      `${englishPrefix}(\\d{1,2})(?:st|nd|rd|th)?\\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s+(\\d{4})`,
      "i"
    )
  );
  if (dayMonth) {
    const month = monthNumber(dayMonth[2]);
    const date = month ? dateFromParts(dayMonth[3], month, dayMonth[1]) : null;
    if (date) return date;
  }

  return null;
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "fbclid"]) {
    url.searchParams.delete(param);
  }

  url.searchParams.sort();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function rssLink(value) {
  if (typeof value === "string") return value.trim() || null;

  for (const candidate of asArray(value)) {
    const maybeText = text(candidate);
    if (maybeText) return maybeText;
  }

  return null;
}

function atomLink(value) {
  for (const candidate of asArray(value)) {
    if (typeof candidate === "string") return candidate.trim() || null;
    if (candidate && typeof candidate === "object") {
      const rel = text(candidate.rel);
      const href = text(candidate.href);
      if (href && (!rel || rel === "alternate")) return href;
    }
  }

  return null;
}

function feedEntryPublishedAt(entry) {
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

async function fetchText(url, accept) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      text: await response.text(),
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") ?? ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function feedDateMap(xml, feedUrl) {
  const parsed = parser.parse(xml);
  const dates = new Map();
  const rssItems = asArray(parsed.rss?.channel?.item);
  const atomEntries = asArray(parsed.feed?.entry);

  for (const item of rssItems) {
    const rawUrl = rssLink(item.link) ?? text(item.guid);
    const date = feedEntryPublishedAt(item);
    if (!rawUrl || !date) continue;
    dates.set(normalizeUrl(new URL(rawUrl, feedUrl).toString()), date);
  }

  for (const entry of atomEntries) {
    const rawUrl = atomLink(entry.link) ?? text(entry.id);
    const date = feedEntryPublishedAt(entry);
    if (!rawUrl || !date) continue;
    dates.set(normalizeUrl(new URL(rawUrl, feedUrl).toString()), date);
  }

  return dates;
}

function getMeta(document, selector) {
  return document.querySelector(selector)?.content?.trim() || null;
}

function getFirstMeta(document, selectors) {
  for (const selector of selectors) {
    const value = getMeta(document, selector);
    if (value) return value;
  }

  return null;
}

function findJsonLdDate(value, keys) {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const date = findJsonLdDate(item, keys);
      if (date) return date;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  for (const key of keys) {
    const date = parseDate(value[key]);
    if (date) return date;
  }

  return findJsonLdDate(value["@graph"], keys);
}

function getJsonLdDate(document, keys) {
  for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const date = findJsonLdDate(JSON.parse(script.textContent ?? ""), keys);
      if (date) return date;
    } catch {
      continue;
    }
  }

  return null;
}

function getTimeElementDate(document) {
  for (const selector of ["time[itemprop='datePublished'][datetime]", "[itemprop='datePublished'][content]", "article time[datetime]", "time[datetime]", "time"]) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const structuredValue = element.getAttribute("datetime") ?? element.getAttribute("content");
      const structuredDate = parseDate(structuredValue);
      if (structuredDate) return { date: structuredDate, source: "article" };

      const textDate = articleTextDate(element.textContent, { allowBareEnglish: true });
      if (textDate) return { date: textDate, source: "article-text" };
    }
  }

  return null;
}

function articlePublishedDate(html, url) {
  const dom = new JSDOM(html, { url, contentType: "text/html" });
  const document = dom.window.document;
  const explicit =
    parseDate(
      getFirstMeta(document, [
        "meta[property='article:published_time']",
        "meta[property='og:published_time']",
        "meta[property='datePublished']",
        "meta[name='date']",
        "meta[name='pubdate']",
        "meta[name='publishdate']",
        "meta[name='publish_date']",
        "meta[name='published-date']",
        "meta[name='parsely-pub-date']",
        "meta[name='sailthru.date']",
        "meta[name='citation_publication_date']",
        "meta[name='DC.date.issued']",
        "meta[name='dc.date']",
        "meta[itemprop='datePublished']"
      ])
    ) ??
    getJsonLdDate(document, ["datePublished", "dateCreated", "uploadDate"]);

  if (explicit) return { date: explicit, source: "article" };

  const timeDate = getTimeElementDate(document);
  if (timeDate) return timeDate;

  const textDate = articleTextDate(document.body?.textContent);
  if (textDate) return { date: textDate, source: "article-text" };

  const modified =
    parseDate(
      getFirstMeta(document, [
        "meta[property='article:modified_time']",
        "meta[name='lastmod']",
        "meta[name='last-modified']",
        "meta[itemprop='dateModified']"
      ])
    ) ?? getJsonLdDate(document, ["dateModified"]);

  return modified ? { date: modified, source: "modified" } : null;
}

function datesDiffer(a, b) {
  if (!a || !b) return Boolean(a || b);
  return Math.abs(a.getTime() - b.getTime()) > 60_000;
}

function shouldUpdateFromArticleResult(item, result) {
  if (result.source === "article") return datesDiffer(item.publishedAt, result.date);
  if (result.source === "article-text") {
    return !item.publishedAt || Math.abs(item.publishedAt.getTime() - result.date.getTime()) > TEXT_DATE_UPDATE_THRESHOLD_MS;
  }

  return !item.publishedAt;
}

async function updateItemDate(item, date, source) {
  if (!datesDiffer(item.publishedAt, date)) return false;
  if (DRY_RUN) {
    console.log(`would update ${source}: ${item.title} -> ${date.toISOString()}`);
    return true;
  }

  await prisma.item.update({
    where: { id: item.id },
    data: { publishedAt: date }
  });
  item.publishedAt = date;
  console.log(`updated ${source}: ${item.title} -> ${date.toISOString()}`);
  return true;
}

async function backfillFromFeeds(itemsByUrl) {
  const sources = await prisma.source.findMany({
    where: { type: "rss", status: { not: "unsubscribed" }, url: { not: null } },
    orderBy: { createdAt: "asc" }
  });
  let checked = 0;
  let matched = 0;
  let updated = 0;

  for (const source of sources) {
    checked += 1;
    try {
      const fetched = await fetchText(source.url, "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.8");
      const dates = feedDateMap(fetched.text, normalizeUrl(fetched.finalUrl));
      for (const [url, publishedAt] of dates) {
        const item = itemsByUrl.get(url);
        if (!item) continue;
        matched += 1;
        if (item.publishedAt && !SHOULD_OVERWRITE_FEED_DATES) continue;
        if (await updateItemDate(item, publishedAt, "feed")) updated += 1;
      }
      console.log(`feed ${checked}/${sources.length}: ${source.name} (${dates.size} dated entries)`);
    } catch (error) {
      console.warn(`feed failed: ${source.name} (${source.url}) ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { checked, matched, updated };
}

async function backfillFromStoredArticles(items) {
  let scanned = 0;
  let found = 0;
  let updated = 0;

  for (const item of items) {
    const html = item.document?.articleHtml;
    const storedText = item.document?.text;
    const result = html ? articlePublishedDate(html, item.url) : storedText ? { date: articleTextDate(storedText), source: "article-text" } : null;
    scanned += 1;
    if (!result?.date) continue;
    found += 1;
    if (result.source === "article" && item.publishedAt && !SHOULD_OVERWRITE_STORED_STRUCTURED_DATES) continue;
    if (result.source === "article-text" && item.articlePageDateFound && item.publishedAt) continue;

    if (shouldUpdateFromArticleResult(item, result) && (await updateItemDate(item, result.date, `stored-${result.source}`))) {
      updated += 1;
    }
  }

  return { scanned, found, updated };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function backfillFromArticlePages(items) {
  let scanned = 0;
  let found = 0;
  let updated = 0;
  let failed = 0;

  await mapLimit(items, ARTICLE_CONCURRENCY, async (item, index) => {
    if (!item.url) return;
    try {
      const fetched = await fetchText(item.url, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      if (!fetched.contentType.toLowerCase().includes("html") && !/<html[\s>]/i.test(fetched.text)) return;
      const result = articlePublishedDate(fetched.text, fetched.finalUrl || item.url);
      scanned += 1;
      if (result) {
        item.articlePageDateFound = true;
        found += 1;
        if (shouldUpdateFromArticleResult(item, result) && (await updateItemDate(item, result.date, result.source))) {
          updated += 1;
        }
      }
    } catch {
      failed += 1;
    } finally {
      if ((index + 1) % 100 === 0 || index + 1 === items.length) {
        console.log(`article pages ${index + 1}/${items.length}: found=${found} updated=${updated} failed=${failed}`);
      }
    }
  });

  return { scanned, found, updated, failed };
}

async function main() {
  const items = await prisma.item.findMany({
    where: { type: "article", url: { not: null }, source: { type: "rss" } },
    select: { id: true, title: true, url: true, publishedAt: true, document: { select: { articleHtml: true, text: true } } },
    orderBy: { createdAt: "asc" }
  });
  const itemsByUrl = new Map();
  for (const item of items) {
    try {
      itemsByUrl.set(normalizeUrl(item.url), item);
    } catch {
      continue;
    }
  }

  console.log(`loaded ${items.length} RSS article items with URLs${DRY_RUN ? " (dry run)" : ""}`);
  const feed = SHOULD_SCAN_FEEDS ? await backfillFromFeeds(itemsByUrl) : null;
  const articlePages = SHOULD_SCAN_ARTICLE_PAGES ? await backfillFromArticlePages(items) : null;
  const storedArticles = SHOULD_SCAN_STORED_ARTICLES ? await backfillFromStoredArticles(items) : null;
  console.log(JSON.stringify({ feed, storedArticles, articlePages }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
