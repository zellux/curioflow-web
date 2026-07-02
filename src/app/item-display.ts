import type { SystemLanguage, UiCopy } from "@/app/i18n";

export type FetchStateItem = {
  status: string;
  type: string;
  url: string | null;
  document: {
    parserVersion: string;
    metadataJson: string;
    text: string;
  } | null;
};

export type ReaderErrorCopy = {
  title: string;
  message: string;
  short: string;
};

export function isArticleFetchError(item: FetchStateItem) {
  return item.type === "article" && item.document?.parserVersion === "mock-url-v1";
}

export function isArticleFetching(item: FetchStateItem) {
  return item.type === "article" && item.status === "pending";
}

export function fallbackReason(metadataJson: string | undefined) {
  if (!metadataJson) return null;

  try {
    const metadata = JSON.parse(metadataJson) as { fallbackReason?: unknown };
    return typeof metadata.fallbackReason === "string" ? metadata.fallbackReason : null;
  } catch {
    return null;
  }
}

export function isSummaryGenerationPending(metadataJson: string | null | undefined) {
  if (!metadataJson) return false;

  try {
    const metadata = JSON.parse(metadataJson) as { summaryStatus?: unknown };
    return metadata.summaryStatus === "pending";
  } catch {
    return false;
  }
}

export function fetchErrorCopy(item: FetchStateItem, copy: UiCopy): ReaderErrorCopy {
  const reason = fallbackReason(item.document?.metadataJson);
  const statusCode = reason?.match(/HTTP\s+(\d+)/i)?.[1];

  if (statusCode) {
    return {
      title: copy.item.fetchFailedTitle,
      message: copy.item.httpFetchMessage(statusCode),
      short: copy.item.httpFetchShort(statusCode)
    };
  }

  if (reason?.toLowerCase().includes("timed out")) {
    return {
      title: copy.item.fetchTimedOutTitle,
      message: copy.item.fetchTimedOutMessage,
      short: copy.item.fetchTimedOutShort
    };
  }

  return {
    title: copy.item.fetchFailedTitle,
    message: copy.item.fetchFailedMessage,
    short: copy.item.fetchFailedShort
  };
}

export function formatDate(date: Date | string | null, locale: SystemLanguage = "en", noDate = "No date") {
  if (!date) return noDate;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric"
  }).format(new Date(date));
}

export function hostnameFor(item: {
  url: string | null;
  contentObject?: { normalizedUrl: string | null } | null;
  source?: { name: string } | null;
}) {
  const url = item.contentObject?.normalizedUrl ?? item.url;
  if (!url) return item.source?.name ?? "Library";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return item.source?.name ?? "Library";
  }
}

export function statusLabel(status: string, copy: UiCopy) {
  if (status === "ready") return copy.common.indexed;
  if (status === "pending") return copy.common.queued;
  if (status === "failed") return copy.item.needsRetry;
  return status;
}

export function itemKindLabel(item: { type: string; source?: { type: string } | null }, copy: UiCopy) {
  if (item.type === "pdf") return copy.item.kind.pdf;
  if (item.type === "podcast" || item.source?.type === "podcast") return copy.item.kind.podcast;
  if (item.source?.type === "rss") return copy.item.kind.feed;
  return copy.item.kind.url;
}

export function estimateRead(text?: string | null, locale: SystemLanguage = "en") {
  if (!text) return locale === "zh-Hans" ? "1 分钟" : "1 min";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 240));
  return locale === "zh-Hans" ? `${minutes} 分钟` : `${minutes} min`;
}

export function summarize(text: string | null | undefined, copy: UiCopy) {
  if (!text) return copy.item.queuedSummary;
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function localeAria(copy: UiCopy, english: string, chinese: string) {
  return copy.locale === "zh-Hans" ? chinese : english;
}
