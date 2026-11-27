"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

function SaveButton({ locale }: { locale: SystemLanguage }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} type="submit">
      {pending
        ? pickLocale(locale, { en: "Saving…", "zh-Hans": "保存中…", "zh-Hant": "儲存中…", ja: "保存中…", ko: "저장 중…" })
        : pickLocale(locale, { en: "Save link", "zh-Hans": "保存链接", "zh-Hant": "儲存連結", ja: "リンクを保存", ko: "링크 저장" })}
    </button>
  );
}

export function AddLinkForm({ action, locale, onFeed }: { action: (data: FormData) => Promise<void>; locale: SystemLanguage; onFeed: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [feed, setFeed] = useState<{ url: string; title: string } | null>(null);
  const copy = pickLocale(locale, {
    en: {
      label: "Article, website, or PDF link",
      help: "Save articles and PDFs to your library to read later.",
      feedFound: "RSS / Atom feed found",
      previewSubscription: "Preview subscription"
    },
    "zh-Hans": {
      label: "文章、网站或 PDF 链接",
      help: "将文章和 PDF 保存到资料库，方便稍后阅读。",
      feedFound: "发现 RSS / Atom 订阅源",
      previewSubscription: "查看并订阅"
    },
    "zh-Hant": {
      label: "文章、網站或 PDF 連結",
      help: "將文章和 PDF 儲存到資料庫，方便稍後閱讀。",
      feedFound: "找到 RSS / Atom 訂閱來源",
      previewSubscription: "預覽並訂閱"
    },
    ja: {
      label: "記事、ウェブサイト、または PDF のリンク",
      help: "記事や PDF をライブラリに保存して、あとで読めます。",
      feedFound: "RSS / Atom フィードが見つかりました",
      previewSubscription: "購読をプレビュー"
    },
    ko: {
      label: "글, 웹사이트 또는 PDF 링크",
      help: "글과 PDF를 라이브러리에 저장해 나중에 읽을 수 있습니다.",
      feedFound: "RSS / Atom 피드를 찾았습니다",
      previewSubscription: "구독 미리보기"
    }
  });
  useEffect(() => {
    setFeed(null);
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) return; } catch { return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/sources/rss/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal: controller.signal });
        const body = await response.json();
        if (!controller.signal.aborted && response.ok && body.preview) setFeed({ url: body.preview.normalizedFeedUrl, title: body.preview.title });
      } catch { /* An ordinary article does not need a feed. */ }
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url]);
  return <form action={action} className="sourceForm">
    <label htmlFor="page-url">{copy.label}</label>
    <input id="page-url" name="url" type="url" placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)} required />
    <small>{copy.help}</small>
    {feed ? <div className="sourcePreview"><div><strong>{feed.title}</strong><small>{copy.feedFound}</small><button type="button" onClick={() => onFeed(feed.url)}>{copy.previewSubscription}</button></div></div> : null}
    <SaveButton locale={locale} />
  </form>;
}
