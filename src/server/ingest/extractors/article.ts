import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ArticleExtraction = {
  title: string;
  author: string | null;
  publishedAt: Date | null;
  language: string | null;
  text: string;
  contentHtml: string | null;
  metadata: Record<string, unknown>;
  parserVersion: string;
};

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 4_000_000;

export class ArticleExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleExtractionError";
  }
}

function parsePublishedTime(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(raw.length === 10 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summaryFromText(text: string, excerpt?: string | null) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
  const overview = (excerpt?.trim() || paragraphs[0] || text).replace(/\s+/g, " ").slice(0, 240);
  const points = paragraphs.slice(1, 4).map((paragraph) => paragraph.slice(0, 180));

  return { overview, points };
}

function getMeta(document: Document, selector: string) {
  return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;
}

function getFirstMeta(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = getMeta(document, selector);
    if (value) return value;
  }

  return null;
}

function findJsonLdDate(value: unknown, keys: string[]): Date | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const date = findJsonLdDate(item, keys);
      if (date) return date;
    }
    return null;
  }

  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const date = parsePublishedTime(record[key]);
    if (date) return date;
  }

  return findJsonLdDate(record["@graph"], keys);
}

function getJsonLdPublishedTime(document: Document) {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']"));
  const publishedKeys = ["datePublished", "dateCreated", "uploadDate"];
  const modifiedKeys = ["dateModified"];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? "") as unknown;
      const date = findJsonLdDate(parsed, publishedKeys);
      if (date) return date;
    } catch {
      continue;
    }
  }

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? "") as unknown;
      const date = findJsonLdDate(parsed, modifiedKeys);
      if (date) return date;
    } catch {
      continue;
    }
  }

  return null;
}

function getTimeElementPublishedTime(document: Document) {
  const selectors = [
    "time[itemprop='datePublished'][datetime]",
    "[itemprop='datePublished'][content]",
    "article time[datetime]",
    "time[datetime]"
  ];

  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    const value = element?.getAttribute("datetime") ?? element?.getAttribute("content") ?? element?.textContent;
    const date = parsePublishedTime(value);
    if (date) return date;
  }

  return null;
}

function getPublishedTime(document: Document, readabilityDate: unknown) {
  return (
    parsePublishedTime(readabilityDate) ??
    parsePublishedTime(
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
    getJsonLdPublishedTime(document) ??
    getTimeElementPublishedTime(document) ??
    parsePublishedTime(
      getFirstMeta(document, [
        "meta[property='article:modified_time']",
        "meta[name='lastmod']",
        "meta[name='last-modified']",
        "meta[itemprop='dateModified']"
      ])
    )
  );
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    if (!response.ok) {
      throw new ArticleExtractionError(`Fetch failed with HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new ArticleExtractionError(`Unsupported content type: ${contentType || "unknown"}`);
    }

    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) {
      throw new ArticleExtractionError(`HTML response is too large: ${html.length} bytes`);
    }

    return {
      html,
      finalUrl: response.url || url,
      contentType
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractArticleWithReadability(url: string): Promise<ArticleExtraction> {
  const fetched = await fetchHtml(url);
  const dom = new JSDOM(fetched.html, {
    url: fetched.finalUrl,
    contentType: "text/html"
  });

  const document = dom.window.document;
  const reader = new Readability(document.cloneNode(true) as Document, {
    charThreshold: 250
  });
  const article = reader.parse();

  if (!article?.textContent?.trim()) {
    throw new ArticleExtractionError("Readability could not find article text");
  }

  const text = normalizeWhitespace(article.textContent);
  if (text.length < 250) {
    throw new ArticleExtractionError("Extracted article text is too short");
  }

  const title =
    article.title?.trim() ||
    getMeta(document, "meta[property='og:title']") ||
    document.title?.trim() ||
    new URL(fetched.finalUrl).hostname;

  const publishedTime = getPublishedTime(document, article.publishedTime);
  const language = article.lang || document.documentElement.lang || null;

  return {
    title,
    author: article.byline?.trim() || getMeta(document, "meta[name='author']"),
    publishedAt: publishedTime,
    language,
    text,
    contentHtml: article.content || null,
    parserVersion: "readability-jsdom-v1",
    metadata: {
      extractor: "readability",
      extractionScope: "full_text",
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      excerpt: article.excerpt,
      summary: {
        ...summaryFromText(text, article.excerpt),
        language,
        source: "extractor"
      },
      siteName: article.siteName,
      length: article.length,
      fetchedAt: new Date().toISOString()
    }
  };
}
