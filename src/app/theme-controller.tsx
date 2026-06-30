"use client";

import { useEffect } from "react";

export type ReadingTheme = "broadsheet" | "journal" | "quiet";

const STORAGE_KEY = "curioflow-reading-theme";
const THEME_CLASSES = ["theme-journal", "theme-quiet"];

export const READING_THEMES: Array<{
  key: ReadingTheme;
  label: string;
  description: string;
  previewClass: string;
}> = [
  {
    key: "broadsheet",
    label: "Broadsheet",
    description: "Warm paper · Spectral",
    previewClass: "themePreviewBroadsheet"
  },
  {
    key: "journal",
    label: "Journal",
    description: "Cool white · Newsreader",
    previewClass: "themePreviewJournal"
  },
  {
    key: "quiet",
    label: "Quiet",
    description: "Greige · Petrona",
    previewClass: "themePreviewQuiet"
  }
];

export function applyReadingTheme(theme: ReadingTheme) {
  document.documentElement.classList.remove(...THEME_CLASSES);
  document.body.classList.remove(...THEME_CLASSES);
  if (theme === "journal") {
    document.documentElement.classList.add("theme-journal");
    document.body.classList.add("theme-journal");
  }
  if (theme === "quiet") {
    document.documentElement.classList.add("theme-quiet");
    document.body.classList.add("theme-quiet");
  }
  document.documentElement.dataset.readingTheme = theme;
}

export function readStoredTheme(): ReadingTheme {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "journal" || value === "quiet" ? value : "broadsheet";
}

export function storeReadingTheme(theme: ReadingTheme) {
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyReadingTheme(theme);
  window.dispatchEvent(new CustomEvent("curioflow-theme-change", { detail: theme }));
}

export function ThemeController() {
  useEffect(() => {
    applyReadingTheme(readStoredTheme());

    function handleThemeChange(event: Event) {
      const theme = event instanceof CustomEvent ? event.detail : readStoredTheme();
      if (theme === "broadsheet" || theme === "journal" || theme === "quiet") {
        applyReadingTheme(theme);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) applyReadingTheme(readStoredTheme());
    }

    window.addEventListener("curioflow-theme-change", handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("curioflow-theme-change", handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
