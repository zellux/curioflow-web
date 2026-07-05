import { lookup } from "node:dns/promises";
import net from "node:net";
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
const MAX_REDIRECTS = 5;
const TWITTER_SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const TWITTER_GUEST_ACTIVATE_URL = "https://api.twitter.com/1.1/guest/activate.json";
const TWITTER_TWEET_RESULT_URL = "https://api.twitter.com/graphql/-4_LMahNlI4MuLJ-EAFEog/TweetResultByRestId";
const TWITTER_BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TWITTER_GRAPHQL_FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: false,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  post_ctas_fetch_enabled: true,
  rweb_cashtags_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true
};
const TWITTER_GRAPHQL_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
  withPayments: false,
  withAuxiliaryUserLabels: false
};

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

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function contentHtmlFromText(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
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

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateIPv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isBlockedAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

async function assertPublicHttpUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ArticleExtractionError("Only HTTP and HTTPS URLs can be fetched");
  }

  if (parsed.username || parsed.password) {
    throw new ArticleExtractionError("URLs with credentials cannot be fetched");
  }

  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")) {
    throw new ArticleExtractionError("Localhost URLs cannot be fetched");
  }

  const addresses = net.isIP(parsed.hostname)
    ? [{ address: parsed.hostname }]
    : await lookup(parsed.hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new ArticleExtractionError("URL resolves to a blocked network address");
  }

  return parsed.toString();
}

async function fetchHtml(url: string, redirectCount = 0): Promise<{ html: string; finalUrl: string; contentType: string }> {
  const safeUrl = await assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safeUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) {
        throw new ArticleExtractionError("Too many redirects while fetching article");
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new ArticleExtractionError("Redirect response did not include a location");
      }

      return fetchHtml(new URL(location, safeUrl).toString(), redirectCount + 1);
    }

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
      finalUrl: response.url || safeUrl,
      contentType
    };
  } finally {
    clearTimeout(timeout);
  }
}

type TwitterSyndicationUser = {
  name?: unknown;
  screen_name?: unknown;
};

type TwitterSyndicationArticle = {
  cover_media?: unknown;
  id?: unknown;
  preview_text?: unknown;
  rest_id?: unknown;
  title?: unknown;
};

type TwitterSyndicationTweet = {
  __typename?: unknown;
  article?: TwitterSyndicationArticle;
  created_at?: unknown;
  entities?: unknown;
  favorite_count?: unknown;
  id_str?: unknown;
  lang?: unknown;
  text?: unknown;
  user?: TwitterSyndicationUser;
};

type TwitterGraphqlUser = {
  core?: {
    name?: unknown;
    screen_name?: unknown;
  };
};

type TwitterArticleBlock = {
  text?: unknown;
  type?: unknown;
};

type TwitterGraphqlArticle = {
  content_state?: {
    blocks?: unknown;
  };
  cover_media?: unknown;
  metadata?: {
    first_published_at_secs?: unknown;
  };
  plain_text?: unknown;
  preview_text?: unknown;
  rest_id?: unknown;
  summary_text?: unknown;
  title?: unknown;
};

type TwitterGraphqlTweet = {
  article?: {
    article_results?: {
      result?: TwitterGraphqlArticle;
    };
  };
  core?: {
    user_results?: {
      result?: TwitterGraphqlUser;
    };
  };
  legacy?: {
    created_at?: unknown;
    favorite_count?: unknown;
    lang?: unknown;
  };
  rest_id?: unknown;
};

type TwitterGraphqlTweetResult = {
  data?: {
    tweetResult?: {
      result?: TwitterGraphqlTweet;
    };
  };
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function twitterPostIdFromUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  if (hostname !== "x.com" && hostname !== "twitter.com" && hostname !== "mobile.twitter.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
  const id = statusIndex >= 0 ? parts[statusIndex + 1] : null;
  return id && /^[0-9]{1,40}$/.test(id) ? id : null;
}

function twitterSyndicationToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

function twitterSyndicationUrl(id: string) {
  const url = new URL(TWITTER_SYNDICATION_URL);
  url.searchParams.set("id", id);
  url.searchParams.set("lang", "en");
  url.searchParams.set(
    "features",
    [
      "tfw_timeline_list:",
      "tfw_follower_count_sunset:true",
      "tfw_tweet_edit_backend:on",
      "tfw_refsrc_session:on",
      "tfw_fosnr_soft_interventions_enabled:on",
      "tfw_show_birdwatch_pivots_enabled:on",
      "tfw_show_business_verified_badge:on",
      "tfw_duplicate_scribes_to_settings:on",
      "tfw_use_profile_image_shape_enabled:on",
      "tfw_show_blue_verified_badge:on",
      "tfw_legacy_timeline_sunset:true",
      "tfw_show_gov_verified_badge:on",
      "tfw_show_business_affiliate_badge:on",
      "tfw_tweet_edit_frontend:on"
    ].join(";")
  );
  url.searchParams.set("token", twitterSyndicationToken(id));
  return url;
}

function expandedArticleUrl(tweet: TwitterSyndicationTweet) {
  const urls = (tweet.entities as { urls?: unknown } | null)?.urls;
  if (!Array.isArray(urls)) return null;

  for (const entry of urls) {
    if (!entry || typeof entry !== "object") continue;
    const expandedUrl = stringValue((entry as { expanded_url?: unknown }).expanded_url);
    if (expandedUrl?.includes("/i/article/")) return expandedUrl;
  }

  return null;
}

async function fetchTwitterSyndicationTweet(id: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(twitterSyndicationUrl(id), {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new ArticleExtractionError(`Twitter syndication returned unsupported content type: ${contentType || "unknown"}`);
    }

    const data = await response.json() as TwitterSyndicationTweet;
    if (!response.ok) {
      throw new ArticleExtractionError(`Twitter syndication fetch failed with HTTP ${response.status}`);
    }

    if (!data || typeof data !== "object" || data.__typename === "TweetTombstone" || !stringValue(data.id_str)) {
      throw new ArticleExtractionError("Twitter syndication could not find the post");
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTwitterGuestToken() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(TWITTER_GUEST_ACTIVATE_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": TWITTER_BEARER_TOKEN,
        "user-agent": "Mozilla/5.0"
      }
    });

    const data = await response.json() as { guest_token?: unknown };
    if (!response.ok) {
      throw new ArticleExtractionError(`Twitter guest token fetch failed with HTTP ${response.status}`);
    }

    const token = stringValue(data.guest_token);
    if (!token) {
      throw new ArticleExtractionError("Twitter guest token response did not include a token");
    }

    return token;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTwitterGraphqlTweet(id: string) {
  const guestToken = await fetchTwitterGuestToken();
  const graphqlUrl = new URL(TWITTER_TWEET_RESULT_URL);
  graphqlUrl.searchParams.set(
    "variables",
    JSON.stringify({
      tweetId: id,
      withCommunity: true,
      includePromotedContent: false,
      withVoice: true
    })
  );
  graphqlUrl.searchParams.set("features", JSON.stringify(TWITTER_GRAPHQL_FEATURES));
  graphqlUrl.searchParams.set("fieldToggles", JSON.stringify(TWITTER_GRAPHQL_FIELD_TOGGLES));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(graphqlUrl, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "authorization": TWITTER_BEARER_TOKEN,
        "user-agent": "Mozilla/5.0",
        "x-guest-token": guestToken,
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en"
      }
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new ArticleExtractionError(`Twitter GraphQL returned unsupported content type: ${contentType || "unknown"}`);
    }

    const data = await response.json() as TwitterGraphqlTweetResult;
    if (!response.ok) {
      throw new ArticleExtractionError(`Twitter GraphQL fetch failed with HTTP ${response.status}`);
    }

    const tweet = data.data?.tweetResult?.result;
    if (!tweet || !stringValue(tweet.rest_id)) {
      throw new ArticleExtractionError("Twitter GraphQL could not find the post");
    }

    return tweet;
  } finally {
    clearTimeout(timeout);
  }
}

function twitterArticleText(article: TwitterGraphqlArticle) {
  const blocks = article.content_state?.blocks;
  if (Array.isArray(blocks)) {
    const blockTexts = blocks
      .map((block) => stringValue((block as TwitterArticleBlock | null)?.text))
      .filter((text): text is string => Boolean(text));
    if (blockTexts.length > 0) return normalizeWhitespace(blockTexts.join("\n\n"));
  }

  return normalizeWhitespace(stringValue(article.plain_text) ?? "");
}

function twitterArticleHtml(article: TwitterGraphqlArticle, text: string) {
  const blocks = article.content_state?.blocks;
  if (!Array.isArray(blocks)) return contentHtmlFromText(text);

  const html = blocks
    .map((block) => {
      const typedBlock = block as TwitterArticleBlock | null;
      const blockText = stringValue(typedBlock?.text);
      if (!blockText) return null;

      const tag = typedBlock?.type === "header-two" ? "h2" : "p";
      return `<${tag}>${escapeHtml(blockText).replace(/\n/g, "<br>")}</${tag}>`;
    })
    .filter(Boolean)
    .join("");

  return html || contentHtmlFromText(text);
}

async function extractTwitterGraphqlArticle(url: string, postId: string): Promise<ArticleExtraction> {
  const tweet = await fetchTwitterGraphqlTweet(postId);
  const article = tweet.article?.article_results?.result;
  if (!article) {
    throw new ArticleExtractionError("Twitter GraphQL returned no article");
  }

  const text = twitterArticleText(article);
  if (!text) {
    throw new ArticleExtractionError("Twitter GraphQL article returned no readable text");
  }

  const userName = stringValue(tweet.core?.user_results?.result?.core?.name);
  const userScreenName = stringValue(tweet.core?.user_results?.result?.core?.screen_name);
  const author = userName && userScreenName ? `${userName} (@${userScreenName})` : userName ?? userScreenName;
  const title = stringValue(article.title) ?? (author ? `${author} on X` : `X post ${postId}`);
  const articleId = stringValue(article.rest_id);
  const articleUrl = articleId ? `https://x.com/i/article/${articleId}` : null;
  const publishedAt = parsePublishedTime(article.metadata?.first_published_at_secs) ?? parsePublishedTime(tweet.legacy?.created_at);
  const language = stringValue(tweet.legacy?.lang);
  const normalizedLanguage = language && language !== "zxx" ? language : null;
  const previewText = stringValue(article.preview_text);

  return {
    title,
    author,
    publishedAt,
    language: normalizedLanguage,
    text,
    contentHtml: twitterArticleHtml(article, text),
    parserVersion: "twitter-graphql-v1",
    metadata: {
      extractor: "twitter-graphql",
      extractionScope: "tweet_article_full_text",
      finalUrl: url,
      postId,
      articleId,
      articleUrl,
      coverMedia: article.cover_media ?? null,
      favoriteCount: typeof tweet.legacy?.favorite_count === "number" ? tweet.legacy.favorite_count : null,
      summary: {
        ...summaryFromText(text, previewText),
        language: normalizedLanguage,
        source: "extractor"
      },
      twitterSummaryText: stringValue(article.summary_text),
      fetchedAt: new Date().toISOString()
    }
  };
}

export async function extractTwitterSyndicationArticle(url: string): Promise<ArticleExtraction | null> {
  const postId = twitterPostIdFromUrl(url);
  if (!postId) return null;

  try {
    return await extractTwitterGraphqlArticle(url, postId);
  } catch {
    // Fall through to the syndication endpoint, which is less complete but more tolerant.
  }

  const tweet = await fetchTwitterSyndicationTweet(postId);
  const article = tweet.article;
  const tweetText = stringValue(tweet.text);
  const articleTitle = stringValue(article?.title);
  const previewText = stringValue(article?.preview_text);
  const userName = stringValue(tweet.user?.name);
  const userScreenName = stringValue(tweet.user?.screen_name);
  const author = userName && userScreenName ? `${userName} (@${userScreenName})` : userName ?? userScreenName;
  const title = articleTitle ?? (author ? `${author} on X` : `X post ${postId}`);
  const publishedAt = parsePublishedTime(tweet.created_at);
  const articleId = stringValue(article?.rest_id);
  const articleUrl = expandedArticleUrl(tweet) ?? (articleId ? `https://x.com/i/article/${articleId}` : null);
  const text = normalizeWhitespace([
    title,
    previewText,
    tweetText && tweetText !== previewText ? `Post: ${tweetText}` : null,
    author ? `By ${author}` : null,
    articleUrl ? `X Article: ${articleUrl}` : null,
    `Original post: ${url}`
  ].filter((part): part is string => Boolean(part)).join("\n\n"));

  if (!text) {
    throw new ArticleExtractionError("Twitter syndication returned no readable text");
  }

  const language = stringValue(tweet.lang);
  const normalizedLanguage = language && language !== "zxx" ? language : null;

  return {
    title,
    author,
    publishedAt,
    language: normalizedLanguage,
    text,
    contentHtml: contentHtmlFromText(text),
    parserVersion: "twitter-syndication-v1",
    metadata: {
      extractor: "twitter-syndication",
      extractionScope: previewText ? "tweet_article_preview" : "tweet_text",
      finalUrl: url,
      postId,
      articleId,
      articleUrl,
      coverMedia: article?.cover_media ?? null,
      favoriteCount: typeof tweet.favorite_count === "number" ? tweet.favorite_count : null,
      summary: {
        ...summaryFromText(text, previewText),
        language: normalizedLanguage,
        source: "extractor"
      },
      fetchedAt: new Date().toISOString()
    }
  };
}

export async function extractArticleWithReadability(url: string): Promise<ArticleExtraction> {
  const twitterExtraction = await extractTwitterSyndicationArticle(url);
  if (twitterExtraction) return twitterExtraction;

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
