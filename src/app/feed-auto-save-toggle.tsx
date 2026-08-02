"use client";

import { useEffect, useState } from "react";
import type { SystemLanguage } from "@/app/i18n";

export function FeedAutoSaveToggle({
  enabled,
  label,
  locale,
  sourceId
}: {
  enabled: boolean;
  label: string;
  locale: SystemLanguage;
  sourceId: string;
}) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!isPending) setIsEnabled(enabled);
  }, [enabled, isPending]);

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
    ? (locale === "zh-Hans" ? "已开启" : "On")
    : (locale === "zh-Hans" ? "已关闭" : "Off");
  const accessibleLabel = `${label}: ${stateLabel}`;

  return (
    <button
      aria-checked={isEnabled}
      aria-label={accessibleLabel}
      className={`feedAutoSaveToggle ${isEnabled ? "isEnabled" : ""}`}
      disabled={isPending}
      onClick={toggle}
      role="switch"
      title={accessibleLabel}
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}
