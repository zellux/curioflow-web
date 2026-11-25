"use client";
import { useEffect, useState } from "react";
import { normalizeSystemLanguage, pickLocale } from "@/app/i18n";
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
  const locale = normalizeSystemLanguage(notice.locale);
  const copy = pickLocale(locale, {
    en: { undoFailed: "Undo failed. Try again.", undo: "Undo", dismiss: "Dismiss notification" },
    "zh-Hans": { undoFailed: "撤销失败，请重试", undo: "撤销", dismiss: "关闭提示" },
    "zh-Hant": { undoFailed: "復原失敗，請重試", undo: "復原", dismiss: "關閉通知" },
    ja: { undoFailed: "元に戻せませんでした。再試行してください。", undo: "元に戻す", dismiss: "通知を閉じる" },
    ko: { undoFailed: "실행 취소에 실패했습니다. 다시 시도해 주세요.", undo: "실행 취소", dismiss: "알림 닫기" }
  });
  return <div className="itemNotice" role="status">
    <span>{failed ? copy.undoFailed : notice.message}</span>
    {notice.undo ? <button disabled={busy} onClick={async () => {
      setBusy(true);
      try { await notice.undo?.(); setNotice(current => current === notice ? null : current); }
      catch { setFailed(true); }
      finally { setBusy(false); }
    }}>{busy ? "…" : copy.undo}</button> : null}
    <button aria-label={copy.dismiss} disabled={busy} onClick={() => setNotice(null)}>×</button>
  </div>;
}
