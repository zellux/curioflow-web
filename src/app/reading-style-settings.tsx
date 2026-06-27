"use client";

import { useEffect, useState } from "react";
import { READING_THEMES, readStoredTheme, storeReadingTheme, type ReadingTheme } from "@/app/theme-controller";

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
          <span className="readingStylePreview" style={{ fontFamily: option.display }}>Ag</span>
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
