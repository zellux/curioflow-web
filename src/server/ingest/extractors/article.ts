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

function parsePublishedTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
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

  const publishedTime =
    parsePublishedTime(article.publishedTime) ??
    parsePublishedTime(getMeta(document, "meta[property='article:published_time']")) ??
    parsePublishedTime(getMeta(document, "meta[name='date']"));
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
