"use client";

import { useEffect, useMemo, useState } from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";

type RssPreviewEntry = {
  title: string | null;
  url: string;
  publishedAt: string | null;
};

type RssPreview = {
  normalizedFeedUrl: string;
  title: string;
  siteUrl: string | null;
  totalEntries: number;
  existingSource: {
    id: string;
    name: string;
    _count?: { items: number };
  } | null;
  entries: RssPreviewEntry[];
};

type PreviewState =
  | { status: "idle"; preview: null; error: null }
  | { status: "checking"; preview: null; error: null }
  | { status: "valid"; preview: RssPreview; error: null }
  | { status: "existing"; preview: RssPreview; error: null }
  | { status: "error"; preview: null; error: string };

export function RssSubscribeForm({
  initialError,
  initialUrl,
  locale = "en",
  subscribeAction
}: {
  initialError?: string | null;
  initialUrl?: string;
  locale?: SystemLanguage;
  subscribeAction: (formData: FormData) => Promise<void>;
}) {
  const copy = getUiCopy(locale);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<PreviewState>(
    initialError ? { status: "error", preview: null, error: initialError } : { status: "idle", preview: null, error: null }
  );

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setState({ status: "idle", preview: null, error: null });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState({ status: "checking", preview: null, error: null });
      try {
        const response = await fetch("/api/sources/rss/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
          signal: controller.signal
        });
        const body = (await response.json().catch(() => null)) as { preview?: RssPreview; error?: string } | null;

        if (!response.ok || !body?.preview) {
          setState({ status: "error", preview: null, error: body?.error ?? (locale === "zh-Hans" ? "无法在这个 URL 中找到 RSS 或 Atom 订阅源" : "Could not find an RSS or Atom feed for this URL") });
          return;
        }

        setState({
          status: body.preview.existingSource ? "existing" : "valid",
          preview: body.preview,
          error: null
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", preview: null, error: locale === "zh-Hans" ? "无法检查这个 URL" : "Could not check this URL" });
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [locale, url]);

  const preview = state.preview;
  const canSubscribe = state.status === "valid";
  const subscribeUrl = state.status === "valid" ? state.preview.normalizedFeedUrl : "";
  const buttonLabel = useMemo(() => {
    if (state.status === "checking") return locale === "zh-Hans" ? "正在检查订阅源..." : "Checking feed...";
    if (state.status === "existing") return locale === "zh-Hans" ? "已订阅" : "Already subscribed";
    return locale === "zh-Hans" ? "订阅这个源" : "Subscribe to this feed";
  }, [locale, state.status]);

  return (
    <form action={subscribeAction} className="sourceForm rssSubscribeForm">
      <label htmlFor="rss-url">{copy.addSource.feedOrSiteUrl}</label>
      {canSubscribe ? <input type="hidden" name="url" value={subscribeUrl} /> : null}
      <input
        id="rss-url"
        name="candidateUrl"
        type="text"
        inputMode="url"
        placeholder={copy.addSource.rssPlaceholder}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />

      {preview ? (
        <div className="rssPreviewCard">
          <div className="sourcePreview">
            <span className="previewIcon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="5" cy="19" r="1.6" />
                <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
              </svg>
            </span>
            <div>
              <strong>{preview.title}</strong>
              <small>
                {copy.addSource.feedDetected(preview.totalEntries)}
              </small>
            </div>
            <span className={state.status === "existing" ? "validBadge muted" : "validBadge"}>
              {state.status === "existing" ? (locale === "zh-Hans" ? "已保存" : "Saved") : (locale === "zh-Hans" ? "有效" : "Valid")}
            </span>
          </div>
          {preview.siteUrl ? <a href={preview.siteUrl} target="_blank" rel="noreferrer">{preview.siteUrl}</a> : null}
          {preview.existingSource ? (
            <a className="sourceInlineLink" href={appHref({ source: preview.existingSource.id, sourceKind: "feed" })}>
              {locale === "zh-Hans" ? `打开已有订阅源 · ${preview.existingSource._count?.items ?? 0} 条` : `Open existing feed · ${preview.existingSource._count?.items ?? 0} items`}
            </a>
          ) : null}
          <div className="rssPreviewEntries">
            {preview.entries.map((entry) => (
              <div key={entry.url}>
                <strong>{entry.title ?? entry.url}</strong>
                <span>{entry.publishedAt ? new Intl.DateTimeFormat(copy.locale, { month: "short", day: "numeric" }).format(new Date(entry.publishedAt)) : new URL(entry.url).hostname}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state.status === "error" ? <div className="sourceError">{state.error}</div> : null}
      <button type="submit" disabled={!canSubscribe}>{buttonLabel}</button>
    </form>
  );
}
