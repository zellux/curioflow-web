"use client";
import { useState } from "react";
import type { SystemLanguage } from "@/app/i18n";

export function ResetReadingButton({ itemId, locale }: { itemId: string; locale: SystemLanguage }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return <button className="readerIconButton" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      const pending: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent("curioflow:reading-reset", { detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }));
      await Promise.all(pending);
      const response = await fetch(`/api/items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ readingProgress: 0, readingPosition: { scrollY: 0 } }) });
      if (!response.ok) throw new Error("Reset failed");
      window.location.reload();
    } catch { window.dispatchEvent(new Event("curioflow:reading-reset-cancel")); setBusy(false); setFailed(true); }
  }}>{failed ? (locale === "zh-Hans" ? "重置失败，请重试" : "Reset failed. Retry") : (locale === "zh-Hans" ? "标记未读" : "Mark unread")}</button>;
}
