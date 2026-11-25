"use client";

import { useEffect, useMemo, useState } from "react";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
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
          setState({
            status: "error",
            preview: null,
            error: body?.error ?? pickLocale(locale, {
              en: "Could not find an RSS or Atom feed for this URL",
              "zh-Hans": "无法在这个 URL 中找到 RSS 或 Atom 订阅源",
              "zh-Hant": "無法在這個 URL 中找到 RSS 或 Atom 訂閱來源",
              ja: "この URL から RSS または Atom フィードが見つかりませんでした",
              ko: "이 URL에서 RSS 또는 Atom 피드를 찾을 수 없습니다"
            })
          });
          return;
        }

        setState({
          status: body.preview.existingSource ? "existing" : "valid",
          preview: body.preview,
          error: null
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          preview: null,
          error: pickLocale(locale, {
            en: "Could not check this URL",
            "zh-Hans": "无法检查这个 URL",
            "zh-Hant": "無法檢查這個 URL",
            ja: "この URL を確認できませんでした",
            ko: "이 URL을 확인할 수 없습니다"
          })
        });
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
    if (state.status === "checking") {
      return pickLocale(locale, {
        en: "Checking feed...",
        "zh-Hans": "正在检查订阅源...",
        "zh-Hant": "正在檢查訂閱來源...",
        ja: "フィードを確認中...",
        ko: "피드 확인 중..."
      });
    }
    if (state.status === "existing") {
      return pickLocale(locale, {
        en: "Already subscribed",
        "zh-Hans": "已订阅",
        "zh-Hant": "已訂閱",
        ja: "購読済み",
        ko: "이미 구독 중"
      });
    }
    return pickLocale(locale, {
      en: "Subscribe to this feed",
      "zh-Hans": "订阅这个源",
      "zh-Hant": "訂閱此來源",
      ja: "このフィードを購読",
      ko: "이 피드 구독하기"
    });
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

      <label className="sourceOption">
        <input name="autoSaveToLibrary" type="checkbox" value="true" />
        <span className="sourceOptionSwitch" aria-hidden="true" />
        <span className="sourceOptionCopy">
          <strong>{copy.addSource.autoSaveFeed}</strong>
          <small>{copy.addSource.autoSaveFeedHelp}</small>
        </span>
      </label>

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
              {state.status === "existing"
                ? pickLocale(locale, { en: "Saved", "zh-Hans": "已保存", "zh-Hant": "已儲存", ja: "保存済み", ko: "저장됨" })
                : pickLocale(locale, { en: "Valid", "zh-Hans": "有效", "zh-Hant": "有效", ja: "有効", ko: "유효함" })}
            </span>
          </div>
          {preview.siteUrl ? <a href={preview.siteUrl} target="_blank" rel="noreferrer">{preview.siteUrl}</a> : null}
          {preview.existingSource ? (
            <a className="sourceInlineLink" href={appHref({ source: preview.existingSource.id, sourceKind: "feed" })}>
              {pickLocale(locale, {
                en: `Open existing feed · ${preview.existingSource._count?.items ?? 0} items`,
                "zh-Hans": `打开已有订阅源 · ${preview.existingSource._count?.items ?? 0} 条`,
                "zh-Hant": `開啟現有訂閱來源 · ${preview.existingSource._count?.items ?? 0} 篇`,
                ja: `既存のフィードを開く · ${preview.existingSource._count?.items ?? 0} 件`,
                ko: `기존 피드 열기 · ${preview.existingSource._count?.items ?? 0}개`
              })}
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
