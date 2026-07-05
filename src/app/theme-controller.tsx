"use client";

import { useEffect } from "react";

export type ReadingFont = "serif" | "sans" | "brush";
export type ColorMode = "bright" | "dark";

const FONT_STORAGE_KEY = "curioflow-reading-font";
const COLOR_MODE_STORAGE_KEY = "curioflow-color-mode";
const LEGACY_THEME_STORAGE_KEY = "curioflow-reading-theme";
const FONT_CLASSES = ["font-sans", "font-brush"];
const COLOR_MODE_CLASSES = ["color-dark"];

export const READING_FONTS: Array<{
  key: ReadingFont;
  label: string;
  description: string;
  previewClass: string;
}> = [
  {
    key: "serif",
    label: "Spectral",
    description: "Warm literary serif",
    previewClass: "fontPreviewSerif"
  },
  {
    key: "sans",
    label: "IBM Plex Sans",
    description: "Clean modern sans",
    previewClass: "fontPreviewSans"
  },
  {
    key: "brush",
    label: "Petrona",
    description: "Soft editorial serif",
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

function normalizeReadingFont(value: string | null | undefined): ReadingFont {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | null | undefined): ColorMode {
  return value === "dark" ? "dark" : "bright";
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

export function readStoredFont(): ReadingFont {
  return normalizeReadingFont(
    window.localStorage.getItem(FONT_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
  );
}

export function readStoredColorMode(): ColorMode {
  return normalizeColorMode(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY));
}

export function storeReadingFont(font: ReadingFont) {
  window.localStorage.setItem(FONT_STORAGE_KEY, font);
  applyReadingFont(font);
  window.dispatchEvent(new CustomEvent("curioflow-reading-font-change", { detail: font }));
}

export function storeColorMode(mode: ColorMode) {
  window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  applyColorMode(mode);
  window.dispatchEvent(new CustomEvent("curioflow-color-mode-change", { detail: mode }));
}

export function ThemeController() {
  useEffect(() => {
    applyReadingFont(readStoredFont());
    applyColorMode(readStoredColorMode());

    function handleFontChange(event: Event) {
      const font = event instanceof CustomEvent ? normalizeReadingFont(event.detail) : readStoredFont();
      applyReadingFont(font);
    }

    function handleColorModeChange(event: Event) {
      const mode = event instanceof CustomEvent ? normalizeColorMode(event.detail) : readStoredColorMode();
      applyColorMode(mode);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === FONT_STORAGE_KEY || event.key === LEGACY_THEME_STORAGE_KEY) {
        applyReadingFont(readStoredFont());
      }
      if (event.key === COLOR_MODE_STORAGE_KEY) {
        applyColorMode(readStoredColorMode());
      }
    }

    window.addEventListener("curioflow-reading-font-change", handleFontChange);
    window.addEventListener("curioflow-color-mode-change", handleColorModeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("curioflow-reading-font-change", handleFontChange);
      window.removeEventListener("curioflow-color-mode-change", handleColorModeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
