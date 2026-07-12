"use client";

import { useEffect, useState } from "react";
import type { SystemLanguage } from "@/app/i18n";
import {
  COLOR_MODES,
  READING_FONTS,
  READING_WIDTHS,
  readStoredColorMode,
  readStoredFont,
  readStoredReadingWidth,
  storeColorMode,
  storeReadingFont,
  storeReadingWidth,
  type ColorMode,
  type ReadingFont,
  type ReadingWidth
} from "@/app/theme-controller";

const FONT_DETAILS: Record<ReadingFont, { cjkFont: string; latinFont: string }> = {
  serif: { cjkFont: "思源宋体", latinFont: "Spectral" },
  sans: { cjkFont: "思源黑体", latinFont: "IBM Plex Sans" },
  brush: { cjkFont: "霞鹜文楷", latinFont: "Petrona" }
};

const FONT_COPY: Record<SystemLanguage, Record<ReadingFont, { label: string; description: string }>> = {
  en: {
    serif: { label: "Classic", description: "Warm serif reading style" },
    sans: { label: "Modern", description: "Clean sans reading style" },
    brush: { label: "Editorial", description: "Soft literary reading style" }
  },
  "zh-Hans": {
    serif: { label: "经典", description: "温暖的衬线阅读样式" },
    sans: { label: "现代", description: "清爽的无衬线阅读样式" },
    brush: { label: "编辑风", description: "柔和的文学阅读样式" }
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

const WIDTH_COPY: Record<SystemLanguage, Record<ReadingWidth, { label: string; description: string }>> = {
  en: {
    narrow: { label: "Narrow", description: "Short lines" },
    medium: { label: "Medium", description: "Balanced" },
    wide: { label: "Wide", description: "Fewer line breaks" }
  },
  "zh-Hans": {
    narrow: { label: "窄", description: "较短行宽" },
    medium: { label: "中", description: "均衡行宽" },
    wide: { label: "宽", description: "减少换行" }
  }
};

export type ReadingStyleInitialState = {
  colorMode: ColorMode;
  font: ReadingFont;
  width: ReadingWidth;
};

export function ReadingStyleSettings({
  initialStyle = { colorMode: "bright", font: "serif", width: "medium" },
  locale = "en"
}: {
  initialStyle?: ReadingStyleInitialState;
  locale?: SystemLanguage;
}) {
  const [font, setFont] = useState<ReadingFont>(initialStyle.font);
  const [colorMode, setColorModeState] = useState<ColorMode>(initialStyle.colorMode);
  const [width, setWidth] = useState<ReadingWidth>(initialStyle.width);

  useEffect(() => {
    setFont(readStoredFont());
    setColorModeState(readStoredColorMode());
    setWidth(readStoredReadingWidth());
  }, []);

  function selectFont(nextFont: ReadingFont) {
    setFont(nextFont);
    storeReadingFont(nextFont);
  }

  function selectColorMode(nextMode: ColorMode) {
    setColorModeState(nextMode);
    storeColorMode(nextMode);
  }

  function selectWidth(nextWidth: ReadingWidth) {
    setWidth(nextWidth);
    storeReadingWidth(nextWidth);
  }

  const fontLabel = locale === "zh-Hans" ? "字体" : "Font";
  const colorLabel = locale === "zh-Hans" ? "颜色" : "Color";
  const widthLabel = locale === "zh-Hans" ? "阅读宽度" : "Reading width";
  const fontIntro = locale === "zh-Hans"
    ? "设置资料库、阅读器、简报和提问页使用的字体。"
    : "Sets the typography used across Library, Reader, Briefing, and Ask.";
  const colorIntro = locale === "zh-Hans"
    ? "明亮适合日间阅读，深色适合低眩光和夜间阅读。"
    : "Bright for daylight reading, Dark for low-glare and night.";
  const widthIntro = locale === "zh-Hans"
    ? "控制阅读器中文章栏的宽度。"
    : "Controls how wide the article column is in the Reader.";

  return (
    <div className="readingStyleStack">
      <section className="readingStyleGroup" aria-labelledby="reading-font-title">
        <h3 id="reading-font-title">{fontLabel}</h3>
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

      <section className="readingStyleGroup" aria-labelledby="reading-width-title">
        <h3 id="reading-width-title">{widthLabel}</h3>
        <p>{widthIntro}</p>
        <div className="readingWidthGrid" role="radiogroup" aria-label={widthLabel}>
          {READING_WIDTHS.map((option) => (
            <button
              aria-checked={width === option.key}
              className={`readingWidthCard ${width === option.key ? "isActive" : ""}`}
              key={option.key}
              onClick={() => selectWidth(option.key)}
              role="radio"
              type="button"
            >
              <span className={`readingWidthPreview readingWidthPreview--${option.key}`}>
                <i /><i /><i />
                {width === option.key ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </span>
              <span className="readingWidthBody">
                <strong>{WIDTH_COPY[locale][option.key].label}</strong>
                <small>{WIDTH_COPY[locale][option.key].description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="readingStyleGroup" aria-labelledby="reading-color-title">
        <h3 id="reading-color-title">{colorLabel}</h3>
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
