"use client";
import { useEffect, useState } from "react";
import { ITEM_NOTICE_EVENT, type ItemNotice } from "@/app/item-action-form";

export function ItemNoticeToast() {
  const [notice, setNotice] = useState<ItemNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const receive = (event: Event) => { setNotice((event as CustomEvent<ItemNotice>).detail); setFailed(false); };
    window.addEventListener(ITEM_NOTICE_EVENT, receive);
    return () => window.removeEventListener(ITEM_NOTICE_EVENT, receive);
  }, []);
  if (!notice) return null;
  const zh = notice.locale === "zh-Hans";
  return <div className="itemNotice" role="status">
    <span>{failed ? (zh ? "撤销失败，请重试" : "Undo failed. Try again.") : notice.message}</span>
    {notice.undo ? <button disabled={busy} onClick={async () => {
      setBusy(true);
      try { await notice.undo?.(); setNotice(current => current === notice ? null : current); }
      catch { setFailed(true); }
      finally { setBusy(false); }
    }}>{busy ? "…" : zh ? "撤销" : "Undo"}</button> : null}
    <button aria-label={zh ? "关闭提示" : "Dismiss notification"} disabled={busy} onClick={() => setNotice(null)}>×</button>
  </div>;
}
