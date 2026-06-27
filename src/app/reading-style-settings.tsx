"use client";

import { useEffect, useState } from "react";
import { READING_THEMES, readStoredTheme, storeReadingTheme, type ReadingTheme } from "@/app/theme-controller";

const STYLE_DETAILS: Record<ReadingTheme, { cnFont: string; ink: string; accent: string }> = {
  broadsheet: { cnFont: "思源宋体 · Song serif", ink: "#1c1714", accent: "#b23a2e" },
  journal: { cnFont: "思源黑体 · Hei sans", ink: "#14171c", accent: "#2f746b" },
  quiet: { cnFont: "霞鹜文楷 · Kai brush", ink: "#211e1b", accent: "#9c5b36" }
};

export function ReadingStyleSettings() {
  const [theme, setTheme] = useState<ReadingTheme>("broadsheet");

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function selectTheme(nextTheme: ReadingTheme) {
    setTheme(nextTheme);
    storeReadingTheme(nextTheme);
  }

  return (
    <div className="readingStyleGrid" role="radiogroup" aria-label="Reading style">
      {READING_THEMES.map((option) => (
        <button
          aria-checked={theme === option.key}
          className={`readingStyleCard ${theme === option.key ? "isActive" : ""} ${option.previewClass}`}
          key={option.key}
          onClick={() => selectTheme(option.key)}
          role="radio"
          type="button"
        >
          <span className="readingStylePreview" style={{ fontFamily: option.display }}>
            <strong>Ag</strong>
            <em>阅读</em>
            <i style={{ background: STYLE_DETAILS[option.key].accent }} />
            <i style={{ background: STYLE_DETAILS[option.key].ink }} />
          </span>
          <span className="readingStyleBody">
            <span>
              <strong>{option.label}</strong>
              {theme === option.key ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </span>
            <small>{option.description}</small>
            <small>{STYLE_DETAILS[option.key].cnFont}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
