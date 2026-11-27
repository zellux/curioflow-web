"use client";

import { useEffect, useState } from "react";
import { isSystemLanguage, pickLocale, SYSTEM_LANGUAGE_LABELS, type SystemLanguage } from "@/app/i18n";
import {
  READER_LANGUAGE_CHANGE_EVENT,
  READER_LANGUAGE_STORAGE_KEY,
  readReaderLanguagePreference,
  resolveListLanguageBadge
} from "@/app/reader-language-preference";

function languageDisplayName(language: string, locale: SystemLanguage) {
  if (isSystemLanguage(language)) return SYSTEM_LANGUAGE_LABELS[language];
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

export function ItemReadingLanguageBadge({
  itemId,
  readyLanguages,
  originalLanguage,
  locale
}: {
  itemId: string;
  readyLanguages: string[];
  originalLanguage: string | null;
  locale: SystemLanguage;
}) {
  const [badgeLanguage, setBadgeLanguage] = useState<string | null>(null);
  const readyKey = readyLanguages.join("\u0000");

  useEffect(() => {
    if (readyLanguages.length === 0) {
      setBadgeLanguage(null);
      return;
    }

    const update = () => {
      const state = readReaderLanguagePreference();
      setBadgeLanguage(resolveListLanguageBadge(state, itemId, readyLanguages, originalLanguage));
    };

    update();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === READER_LANGUAGE_STORAGE_KEY) update();
    };
    window.addEventListener(READER_LANGUAGE_CHANGE_EVENT, update);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", update);
    return () => {
      window.removeEventListener(READER_LANGUAGE_CHANGE_EVENT, update);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", update);
    };
    // readyKey tracks the contents of readyLanguages across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, readyKey, originalLanguage]);

  if (!badgeLanguage) return null;

  const label = languageDisplayName(badgeLanguage, locale);
  const title = pickLocale(locale, {
    en: `Opens in ${label}`,
    "zh-Hans": `打开时显示${label}`,
    "zh-Hant": `開啟時顯示${label}`,
    ja: `${label}で開きます`,
    ko: `${label}(으)로 열림`
  });

  return (
    <span className="itemReadingLanguageBadge" title={title} aria-label={title}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
