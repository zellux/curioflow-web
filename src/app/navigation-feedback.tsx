"use client";

import type { SystemLanguage } from "@/app/i18n";
import { useNavigationState } from "@/app/navigation-state";

export function NavigationFeedback({ locale }: { locale: SystemLanguage }) {
  const { pending } = useNavigationState();
  const label = locale === "zh-Hans" ? "正在打开页面…" : "Opening page…";
  return <div className={`navigationFeedback${pending ? " navigationFeedback--pending" : ""}`}>
    {pending ? <div className="navigationProgress" aria-hidden="true"><span /></div> : null}
    <div className="navigationNotice" role="status" aria-live="polite" aria-atomic="true">
      {pending ? <><i aria-hidden="true" /><span>{label}</span></> : null}
    </div>
  </div>;
}
