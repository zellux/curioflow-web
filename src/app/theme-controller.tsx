"use client";

import { useEffect } from "react";

export type ReadingFont = "serif" | "sans" | "brush";
export type ColorMode = "bright" | "dark";
export type ReadingWidth = "narrow" | "medium" | "wide";

const FONT_STORAGE_KEY = "curioflow-reading-font";
const COLOR_MODE_STORAGE_KEY = "curioflow-color-mode";
const READING_WIDTH_STORAGE_KEY = "curioflow-reading-width";
const LEGACY_THEME_STORAGE_KEY = "curioflow-reading-theme";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const FONT_CLASSES = ["font-sans", "font-brush"];
const COLOR_MODE_CLASSES = ["color-dark"];
const READING_WIDTH_CLASSES = ["reading-width-narrow", "reading-width-wide"];

export const READING_FONTS: Array<{
  key: ReadingFont;
  label: string;
  description: string;
  previewClass: string;
}> = [
  {
    key: "serif",
    label: "Classic",
    description: "Warm serif reading style",
    previewClass: "fontPreviewSerif"
  },
  {
    key: "sans",
    label: "Modern",
    description: "Clean sans reading style",
    previewClass: "fontPreviewSans"
  },
  {
    key: "brush",
    label: "Editorial",
    description: "Soft literary reading style",
    previewClass: "fontPreviewBrush"
  }
];

export const COLOR_MODES: Array<{
  key: ColorMode;
  label: string;
  description: string;
}> = [
  { key: "bright", label: "Bright", description: "Warm, light paper" },
  { key: "dark", label: "Dark", description: "Low-glare, night reading" }
];

export const READING_WIDTHS: Array<{ key: ReadingWidth }> = [
  { key: "narrow" },
  { key: "medium" },
  { key: "wide" }
];

function normalizeReadingFont(value: string | null | undefined): ReadingFont {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | null | undefined): ColorMode {
  return value === "dark" ? "dark" : "bright";
}

function normalizeReadingWidth(value: string | null | undefined): ReadingWidth {
  if (value === "narrow" || value === "wide") return value;
  return "medium";
}

export function applyReadingFont(font: ReadingFont) {
  document.documentElement.classList.remove(...FONT_CLASSES);
  document.body.classList.remove(...FONT_CLASSES);
  if (font === "sans") {
    document.documentElement.classList.add("font-sans");
    document.body.classList.add("font-sans");
  }
  if (font === "brush") {
    document.documentElement.classList.add("font-brush");
    document.body.classList.add("font-brush");
  }
  document.documentElement.dataset.readingFont = font;
}

export function applyColorMode(mode: ColorMode) {
  document.documentElement.classList.remove(...COLOR_MODE_CLASSES);
  document.body.classList.remove(...COLOR_MODE_CLASSES);
  if (mode === "dark") {
    document.documentElement.classList.add("color-dark");
    document.body.classList.add("color-dark");
  }
  document.documentElement.dataset.colorMode = mode;
}

export function applyReadingWidth(width: ReadingWidth) {
  document.documentElement.classList.remove(...READING_WIDTH_CLASSES);
  if (width !== "medium") {
    document.documentElement.classList.add(`reading-width-${width}`);
  }
  document.documentElement.dataset.readingWidth = width;
}

export function readStoredFont(): ReadingFont {
  return normalizeReadingFont(
    window.localStorage.getItem(FONT_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY) ??
      document.documentElement.dataset.readingFont
  );
}

export function readStoredColorMode(): ColorMode {
  return normalizeColorMode(
    window.localStorage.getItem(COLOR_MODE_STORAGE_KEY) ??
      document.documentElement.dataset.colorMode
  );
}

export function readStoredReadingWidth(): ReadingWidth {
  return normalizeReadingWidth(
    window.localStorage.getItem(READING_WIDTH_STORAGE_KEY) ??
      document.documentElement.dataset.readingWidth
  );
}

function storePreferenceCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function storeReadingFont(font: ReadingFont) {
  window.localStorage.setItem(FONT_STORAGE_KEY, font);
  storePreferenceCookie(FONT_STORAGE_KEY, font);
  applyReadingFont(font);
  window.dispatchEvent(new CustomEvent("curioflow-reading-font-change", { detail: font }));
}

export function storeColorMode(mode: ColorMode) {
  window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  storePreferenceCookie(COLOR_MODE_STORAGE_KEY, mode);
  applyColorMode(mode);
  window.dispatchEvent(new CustomEvent("curioflow-color-mode-change", { detail: mode }));
}

export function storeReadingWidth(width: ReadingWidth) {
  window.localStorage.setItem(READING_WIDTH_STORAGE_KEY, width);
  storePreferenceCookie(READING_WIDTH_STORAGE_KEY, width);
  applyReadingWidth(width);
  window.dispatchEvent(new CustomEvent("curioflow-reading-width-change", { detail: width }));
}

export function ThemeController() {
  useEffect(() => {
    const font = readStoredFont();
    const colorMode = readStoredColorMode();
    const readingWidth = readStoredReadingWidth();
    applyReadingFont(font);
    applyColorMode(colorMode);
    applyReadingWidth(readingWidth);
    storePreferenceCookie(FONT_STORAGE_KEY, font);
    storePreferenceCookie(COLOR_MODE_STORAGE_KEY, colorMode);
    storePreferenceCookie(READING_WIDTH_STORAGE_KEY, readingWidth);

    function handleFontChange(event: Event) {
      const font = event instanceof CustomEvent ? normalizeReadingFont(event.detail) : readStoredFont();
      applyReadingFont(font);
    }

    function handleColorModeChange(event: Event) {
      const mode = event instanceof CustomEvent ? normalizeColorMode(event.detail) : readStoredColorMode();
      applyColorMode(mode);
    }

    function handleReadingWidthChange(event: Event) {
      const width = event instanceof CustomEvent ? normalizeReadingWidth(event.detail) : readStoredReadingWidth();
      applyReadingWidth(width);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === FONT_STORAGE_KEY || event.key === LEGACY_THEME_STORAGE_KEY) {
        applyReadingFont(readStoredFont());
      }
      if (event.key === COLOR_MODE_STORAGE_KEY) {
        applyColorMode(readStoredColorMode());
      }
      if (event.key === READING_WIDTH_STORAGE_KEY) {
        applyReadingWidth(readStoredReadingWidth());
      }
    }

    window.addEventListener("curioflow-reading-font-change", handleFontChange);
    window.addEventListener("curioflow-color-mode-change", handleColorModeChange);
    window.addEventListener("curioflow-reading-width-change", handleReadingWidthChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("curioflow-reading-font-change", handleFontChange);
      window.removeEventListener("curioflow-color-mode-change", handleColorModeChange);
      window.removeEventListener("curioflow-reading-width-change", handleReadingWidthChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
