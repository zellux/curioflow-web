"use client";

import { useEffect, useState } from "react";
import type { SystemLanguage } from "@/app/i18n";
import {
  COLOR_MODES,
  READING_FONTS,
  readStoredColorMode,
  readStoredFont,
  storeColorMode,
  storeReadingFont,
  type ColorMode,
  type ReadingFont
} from "@/app/theme-controller";

const FONT_DETAILS: Record<ReadingFont, { cjkFont: string; latinFont: string }> = {
  serif: { cjkFont: "思源宋体", latinFont: "Spectral" },
  sans: { cjkFont: "思源黑体", latinFont: "IBM Plex Sans" },
  brush: { cjkFont: "霞鹜文楷", latinFont: "Petrona" }
};

const FONT_COPY: Record<SystemLanguage, Record<ReadingFont, { label: string; description: string }>> = {
  en: {
    serif: { label: "Spectral", description: "Warm literary serif" },
    sans: { label: "IBM Plex Sans", description: "Clean modern sans" },
    brush: { label: "Petrona", description: "Soft editorial · 文楷" }
  },
  "zh-Hans": {
    serif: { label: "Spectral", description: "温暖的文学衬线体" },
    sans: { label: "IBM Plex Sans", description: "清爽的现代黑体" },
    brush: { label: "Petrona", description: "柔和的编辑风 · 文楷" }
  }
};

const COLOR_COPY: Record<SystemLanguage, Record<ColorMode, { label: string; description: string }>> = {
  en: {
    bright: { label: "Bright", description: "Warm, light paper" },
    dark: { label: "Dark", description: "Low-glare, night reading" }
  },
  "zh-Hans": {
    bright: { label: "明亮", description: "温暖的浅色纸张" },
    dark: { label: "深色", description: "低眩光夜间阅读" }
  }
};

export type ReadingStyleInitialState = {
  colorMode: ColorMode;
  font: ReadingFont;
};

export function ReadingStyleSettings({
  initialStyle = { colorMode: "bright", font: "serif" },
  locale = "en"
}: {
  initialStyle?: ReadingStyleInitialState;
  locale?: SystemLanguage;
}) {
  const [font, setFont] = useState<ReadingFont>(initialStyle.font);
  const [colorMode, setColorModeState] = useState<ColorMode>(initialStyle.colorMode);

  useEffect(() => {
    setFont(readStoredFont());
    setColorModeState(readStoredColorMode());
  }, []);

  function selectFont(nextFont: ReadingFont) {
    setFont(nextFont);
    storeReadingFont(nextFont);
  }

  function selectColorMode(nextMode: ColorMode) {
    setColorModeState(nextMode);
    storeColorMode(nextMode);
  }

  const fontLabel = locale === "zh-Hans" ? "字体" : "Font";
  const colorLabel = locale === "zh-Hans" ? "颜色" : "Color";
  const fontIntro = locale === "zh-Hans"
    ? "设置资料库、阅读器、简报和提问页使用的字体。"
    : "Sets the typography used across Library, Reader, Briefing, and Ask.";
  const colorIntro = locale === "zh-Hans"
    ? "明亮适合日间阅读，深色适合低眩光和夜间阅读。"
    : "Bright for daylight reading, Dark for low-glare and night.";

  return (
    <div className="readingStyleStack">
      <section className="readingStyleGroup" aria-labelledby="reading-font-title">
        <h4 id="reading-font-title">{fontLabel}</h4>
        <p>{fontIntro}</p>
        <div className="readingStyleGrid" role="radiogroup" aria-label={fontLabel}>
          {READING_FONTS.map((option) => (
            <button
              aria-checked={font === option.key}
              className={`readingStyleCard ${font === option.key ? "isActive" : ""} ${option.previewClass}`}
              key={option.key}
              onClick={() => selectFont(option.key)}
              role="radio"
              type="button"
            >
              <span className="readingStylePreview">
                <strong>Ag</strong>
                <em>阅读</em>
                {font === option.key ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </span>
              <span className="readingStyleBody">
                <strong>{FONT_COPY[locale][option.key].label}</strong>
                <small>{FONT_COPY[locale][option.key].description}</small>
                <small className="readingStyleFontSample">{`${FONT_DETAILS[option.key].cjkFont} · ${FONT_DETAILS[option.key].latinFont}`}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="readingStyleGroup" aria-labelledby="reading-color-title">
        <h4 id="reading-color-title">{colorLabel}</h4>
        <p>{colorIntro}</p>
        <div className="colorModeGrid" role="radiogroup" aria-label={colorLabel}>
          {COLOR_MODES.map((option) => (
            <button
              aria-checked={colorMode === option.key}
              className={`colorModeCard colorModeCard--${option.key} ${colorMode === option.key ? "isActive" : ""}`}
              key={option.key}
              onClick={() => selectColorMode(option.key)}
              role="radio"
              type="button"
            >
              <span className="colorModePreview">
                <i />
                <i />
                {colorMode === option.key ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </span>
              <span className="colorModeBody">
                <strong>{COLOR_COPY[locale][option.key].label}</strong>
                <small>{COLOR_COPY[locale][option.key].description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
