"use client";

import { useCallback, useEffect, useState } from "react";

import { pickLocale, type SystemLanguage } from "@/app/i18n";

const FOCUS_STORAGE_KEY = "curioflow-reader-focus";
const FOCUS_CLASS = "reader-focus";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}

function readStoredFocus() {
  try {
    return window.localStorage.getItem(FOCUS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeFocus(value: boolean) {
  try {
    window.localStorage.setItem(FOCUS_STORAGE_KEY, value ? "1" : "0");
  } catch {
    return;
  }
}

export function ReaderFocusToggle({ locale, variant = "button" }: { locale: SystemLanguage; variant?: "button" | "menu" }) {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setFocused(readStoredFocus());
    return () => document.documentElement.classList.remove(FOCUS_CLASS);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(FOCUS_CLASS, focused);
  }, [focused]);

  const toggle = useCallback(() => {
    setFocused((current) => {
      storeFocus(!current);
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "f" && event.key !== "F") return;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target) || document.querySelector("[role='dialog'][aria-modal='true']")) return;
      event.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const label = focused
    ? pickLocale(locale, {
      en: "Exit focus mode (F)",
      "zh-Hans": "退出专注阅读 (F)",
      "zh-Hant": "退出專注閱讀 (F)",
      ja: "集中モードを終了 (F)",
      ko: "집중 모드 종료 (F)"
    })
    : pickLocale(locale, {
      en: "Focus mode (F)",
      "zh-Hans": "专注阅读 (F)",
      "zh-Hant": "專注閱讀 (F)",
      ja: "集中モード (F)",
      ko: "집중 모드 (F)"
    });

  return (
    <button
      aria-label={variant === "menu" ? undefined : label}
      aria-pressed={variant === "menu" ? undefined : focused}
      className={variant === "menu" ? "readerMoreItem" : "readerIconButton readerFocusToggle"}
      data-close-menu={variant === "menu" ? "" : undefined}
      onClick={toggle}
      role={variant === "menu" ? "menuitem" : undefined}
      title={label}
      type="button"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {focused ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
      {variant === "menu" ? <span>{label}</span> : null}
    </button>
  );
}
