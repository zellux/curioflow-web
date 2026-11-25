"use client";

import { useEffect, useState } from "react";
import { pickLocale, type SystemLanguage } from "@/app/i18n";
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
  serif: { cjkFont: "思源宋体", latinFont: "Source Serif 4" },
  sans: { cjkFont: "苹方", latinFont: "Nunito Sans" },
  brush: { cjkFont: "霞鹜文楷", latinFont: "Alegreya" }
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
  },
  "zh-Hant": {
    serif: { label: "經典", description: "溫暖的襯線閱讀樣式" },
    sans: { label: "現代", description: "清爽的無襯線閱讀樣式" },
    brush: { label: "編輯風", description: "柔和的文學閱讀樣式" }
  },
  ja: {
    serif: { label: "クラシック", description: "温かみのある明朝スタイル" },
    sans: { label: "モダン", description: "すっきりしたゴシック体" },
    brush: { label: "エディトリアル", description: "柔らかな文芸スタイル" }
  },
  ko: {
    serif: { label: "클래식", description: "따뜻한 세리프 읽기 스타일" },
    sans: { label: "모던", description: "깔끔한 산세리프 스타일" },
    brush: { label: "에디토리얼", description: "부드러운 문학 읽기 스타일" }
  }
};

const COLOR_COPY: Record<SystemLanguage, Record<ColorMode, { label: string; description: string }>> = {
  en: {
    bright: { label: "Bright", description: "Warm, light paper" },
    dark: { label: "Dark", description: "Low-glare, night reading" },
    system: { label: "System", description: "Follow your device setting" }
  },
  "zh-Hans": {
    bright: { label: "明亮", description: "温暖的浅色纸张" },
    dark: { label: "深色", description: "低眩光夜间阅读" },
    system: { label: "跟随系统", description: "随设备外观自动切换" }
  },
  "zh-Hant": {
    bright: { label: "明亮", description: "溫暖的淺色紙張" },
    dark: { label: "深色", description: "低眩光夜間閱讀" },
    system: { label: "跟隨系統", description: "隨裝置外觀自動切換" }
  },
  ja: {
    bright: { label: "ライト", description: "温かみのある明るい紙面" },
    dark: { label: "ダーク", description: "目に優しい夜間向け配色" },
    system: { label: "システム", description: "デバイスの設定に合わせる" }
  },
  ko: {
    bright: { label: "밝게", description: "따뜻하고 밝은 종이 톤" },
    dark: { label: "어둡게", description: "눈부심이 적은 야간 읽기" },
    system: { label: "시스템", description: "기기 설정에 따라 자동 전환" }
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
  },
  "zh-Hant": {
    narrow: { label: "窄", description: "較短行寬" },
    medium: { label: "中", description: "均衡行寬" },
    wide: { label: "寬", description: "減少換行" }
  },
  ja: {
    narrow: { label: "狭い", description: "短めの行幅" },
    medium: { label: "標準", description: "バランスの良い幅" },
    wide: { label: "広い", description: "改行を少なめに" }
  },
  ko: {
    narrow: { label: "좁게", description: "짧은 줄 길이" },
    medium: { label: "보통", description: "균형 잡힌 폭" },
    wide: { label: "넓게", description: "줄바꿈 최소화" }
  }
};

const SECTION_COPY: Record<SystemLanguage, {
  colorIntro: string;
  colorLabel: string;
  fontIntro: string;
  fontLabel: string;
  widthIntro: string;
  widthLabel: string;
}> = {
  en: {
    colorIntro: "Bright for daylight reading, Dark for low-glare and night, or follow your device.",
    colorLabel: "Color",
    fontIntro: "Sets the typography used across Library and Reader.",
    fontLabel: "Font",
    widthIntro: "Controls how wide the article column is in the Reader.",
    widthLabel: "Reading width"
  },
  "zh-Hans": {
    colorIntro: "明亮适合日间阅读，深色适合低眩光和夜间阅读，也可跟随系统。",
    colorLabel: "颜色",
    fontIntro: "设置资料库和阅读器使用的字体。",
    fontLabel: "字体",
    widthIntro: "控制阅读器中文章栏的宽度。",
    widthLabel: "阅读宽度"
  },
  "zh-Hant": {
    colorIntro: "明亮適合日間閱讀，深色適合低眩光與夜間閱讀，也可跟隨系統。",
    colorLabel: "顏色",
    fontIntro: "設定資料庫與閱讀器使用的字型。",
    fontLabel: "字型",
    widthIntro: "控制閱讀器中文章欄位的寬度。",
    widthLabel: "閱讀寬度"
  },
  ja: {
    colorIntro: "日中はライト、夜間はダーク、またはデバイスの外観設定に合わせられます。",
    colorLabel: "カラー",
    fontIntro: "ライブラリとリーダーで使用する書体を設定します。",
    fontLabel: "フォント",
    widthIntro: "リーダーでの記事カラム幅を調整します。",
    widthLabel: "本文の幅"
  },
  ko: {
    colorIntro: "주간에는 밝게, 야간에는 눈부심이 적은 어둡게, 또는 기기 설정을 따를 수 있습니다.",
    colorLabel: "색상",
    fontIntro: "라이브러리와 리더에서 사용할 글꼴을 설정합니다.",
    fontLabel: "글꼴",
    widthIntro: "리더의 본문 열 너비를 조절합니다.",
    widthLabel: "읽기 너비"
  }
};

export type ReadingStyleInitialState = {
  colorMode: ColorMode;
  font: ReadingFont;
  width: ReadingWidth;
};

export function ReadingStyleSettings({
  initialStyle = { colorMode: "bright", font: "serif", width: "medium" },
  locale = "en",
  onChange
}: {
  initialStyle?: ReadingStyleInitialState;
  locale?: SystemLanguage;
  onChange?: () => void;
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
    onChange?.();
  }

  function selectColorMode(nextMode: ColorMode) {
    setColorModeState(nextMode);
    storeColorMode(nextMode);
    onChange?.();
  }

  function selectWidth(nextWidth: ReadingWidth) {
    setWidth(nextWidth);
    storeReadingWidth(nextWidth);
    onChange?.();
  }

  const { fontLabel, colorLabel, widthLabel, fontIntro, colorIntro, widthIntro } = pickLocale(locale, SECTION_COPY);

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
