"use client";
import { useState } from "react";
import { pickLocale, type SystemLanguage } from "@/app/i18n";
import { MarkUnreadIcon } from "@/app/item-icons";

export function ResetReadingButton({ itemId, locale }: { itemId: string; locale: SystemLanguage }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = failed
    ? pickLocale(locale, {
      en: "Reset failed. Retry",
      "zh-Hans": "重置失败，请重试",
      "zh-Hant": "重設失敗，請重試",
      ja: "リセットに失敗しました。再試行",
      ko: "초기화 실패. 다시 시도"
    })
    : pickLocale(locale, {
      en: "Mark unread",
      "zh-Hans": "标记未读",
      "zh-Hant": "標記為未讀",
      ja: "未読にする",
      ko: "읽지 않음으로 표시"
    });
  return <button className="readerMoreItem" disabled={busy} role="menuitem" type="button" onClick={async () => {
    setBusy(true);
    try {
      const pending: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent("curioflow:reading-reset", { detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }));
      await Promise.all(pending);
      const response = await fetch(`/api/items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ readingProgress: 0, readingPosition: { scrollY: 0 } }) });
      if (!response.ok) throw new Error("Reset failed");
      window.location.reload();
    } catch { window.dispatchEvent(new Event("curioflow:reading-reset-cancel")); setBusy(false); setFailed(true); }
  }}>
    <MarkUnreadIcon size={15} />
    <span>{label}</span>
  </button>;
}
