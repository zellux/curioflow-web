"use client";

import { useEffect, useState } from "react";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

export function FeedAutoSaveToggle({
  enabled,
  label,
  locale,
  sourceId,
  variant = "button"
}: {
  enabled: boolean;
  label: string;
  locale: SystemLanguage;
  sourceId: string;
  variant?: "button" | "menu";
}) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setIsEnabled(enabled);
  }, [enabled]);

  async function toggle() {
    if (isPending) return;
    const nextEnabled = !isEnabled;
    setIsEnabled(nextEnabled);
    setIsPending(true);

    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoSaveToLibrary: nextEnabled })
      });
      if (!response.ok) throw new Error("Unable to update feed");
    } catch {
      setIsEnabled(!nextEnabled);
    } finally {
      setIsPending(false);
    }
  }

  const stateLabel = isEnabled
    ? pickLocale(locale, { en: "On", "zh-Hans": "已开启", "zh-Hant": "已開啟", ja: "オン", ko: "켜짐" })
    : pickLocale(locale, { en: "Off", "zh-Hans": "已关闭", "zh-Hant": "已關閉", ja: "オフ", ko: "꺼짐" });
  const accessibleLabel = `${label}: ${stateLabel}`;

  return (
    <button
      aria-checked={isEnabled}
      aria-label={accessibleLabel}
      className={`${variant === "menu" ? "readerMoreItem feedAutoSaveToggle feedAutoSaveToggle--menu" : "feedAutoSaveToggle"}${isEnabled ? " isEnabled" : ""}`}
      disabled={isPending}
      onClick={toggle}
      role={variant === "menu" ? "menuitemcheckbox" : "switch"}
      title={accessibleLabel}
      type="button"
    >
      {variant === "menu" ? <span>{label}</span> : label}
      <span className="feedAutoSaveTrack" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
