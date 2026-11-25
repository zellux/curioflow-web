"use client";

import { pickLocale, type SystemLanguage } from "@/app/i18n";
import { useNavigationState } from "@/app/navigation-state";

export function NavigationFeedback({ locale }: { locale: SystemLanguage }) {
  const { pending } = useNavigationState();
  const label = pickLocale(locale, {
    en: "Opening page…",
    "zh-Hans": "正在打开页面…",
    "zh-Hant": "正在開啟頁面…",
    ja: "ページを開いています…",
    ko: "페이지 여는 중…"
  });
  return <div className={`navigationFeedback${pending ? " navigationFeedback--pending" : ""}`}>
    {pending ? <div className="navigationProgress" aria-hidden="true"><span /></div> : null}
    <div className="navigationStatusLabel" role="status" aria-live="polite" aria-atomic="true">
      {pending ? label : null}
    </div>
  </div>;
}
