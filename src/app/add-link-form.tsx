"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SystemLanguage } from "@/app/i18n";

function SaveButton({ zh }: { zh: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit">{pending ? (zh ? "保存中…" : "Saving…") : (zh ? "保存文章" : "Save article")}</button>;
}

export function AddLinkForm({ action, locale, onFeed }: { action: (data: FormData) => Promise<void>; locale: SystemLanguage; onFeed: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [feed, setFeed] = useState<{ url: string; title: string } | null>(null);
  const zh = locale === "zh-Hans";
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
    <label htmlFor="page-url">{zh ? "文章或网站链接" : "Article or website link"}</label>
    <input id="page-url" name="url" type="url" placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)} required />
    <small>{zh ? "文章会保存到资料库，方便稍后阅读。" : "Articles are saved to your library to read later."}</small>
    {feed ? <div className="sourcePreview"><div><strong>{feed.title}</strong><small>{zh ? "发现 RSS / Atom 订阅源" : "RSS / Atom feed found"}</small><button type="button" onClick={() => onFeed(feed.url)}>{zh ? "查看并订阅" : "Preview subscription"}</button></div></div> : null}
    <SaveButton zh={zh} />
  </form>;
}
