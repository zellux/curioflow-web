"use client";

import { useEffect, useState } from "react";
import type { SystemLanguage } from "@/app/i18n";
import { READING_THEMES, readStoredTheme, storeReadingTheme, type ReadingTheme } from "@/app/theme-controller";

const STYLE_DETAILS: Record<ReadingTheme, { cjkFont: string; latinFont: string; ink: string; accent: string }> = {
  broadsheet: { cjkFont: "思源宋体", latinFont: "Song serif", ink: "#1c1714", accent: "#b23a2e" },
  journal: { cjkFont: "思源黑体", latinFont: "IBM Plex sans", ink: "#14171c", accent: "#2f746b" },
  quiet: { cjkFont: "霞鹜文楷", latinFont: "Kai brush", ink: "#211e1b", accent: "#9c5b36" }
};

const STYLE_COPY: Record<SystemLanguage, Record<ReadingTheme, { label: string; description: string }>> = {
  en: {
    broadsheet: { label: "Broadsheet", description: "Warm cream · Spectral serif" },
    journal: { label: "Journal", description: "Cool white · IBM Plex sans" },
    quiet: { label: "Quiet", description: "Greige · Petrona · 文楷" }
  },
  "zh-Hans": {
    broadsheet: { label: "报刊", description: "暖色纸张 · Spectral serif" },
    journal: { label: "杂志", description: "冷白底色 · IBM Plex sans" },
    quiet: { label: "静读", description: "灰米底色 · Petrona · 文楷" }
  }
};

export function ReadingStyleSettings({ locale = "en" }: { locale?: SystemLanguage }) {
  const [theme, setTheme] = useState<ReadingTheme>("broadsheet");

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function selectTheme(nextTheme: ReadingTheme) {
    setTheme(nextTheme);
    storeReadingTheme(nextTheme);
  }

  return (
    <div className="readingStyleGrid" role="radiogroup" aria-label={locale === "zh-Hans" ? "阅读样式" : "Reading style"}>
      {READING_THEMES.map((option) => (
        <button
          aria-checked={theme === option.key}
          className={`readingStyleCard ${theme === option.key ? "isActive" : ""} ${option.previewClass}`}
          key={option.key}
          onClick={() => selectTheme(option.key)}
          role="radio"
          type="button"
        >
          <span className="readingStylePreview">
            <strong>Ag</strong>
            <em>阅读</em>
            <i style={{ background: STYLE_DETAILS[option.key].accent }} />
            <i style={{ background: STYLE_DETAILS[option.key].ink }} />
          </span>
          <span className="readingStyleBody">
            <span>
              <strong>{STYLE_COPY[locale][option.key].label}</strong>
              {theme === option.key ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </span>
            <small>{STYLE_COPY[locale][option.key].description}</small>
            <small className="readingStyleFontSample">
              <span>{STYLE_DETAILS[option.key].cjkFont}</span>
              <b aria-hidden="true">·</b>
              <em>{STYLE_DETAILS[option.key].latinFont}</em>
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
