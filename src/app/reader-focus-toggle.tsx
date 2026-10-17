"use client";

import { useCallback, useEffect, useState } from "react";

import type { SystemLanguage } from "@/app/i18n";

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

export function ReaderFocusToggle({ locale }: { locale: SystemLanguage }) {
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
    ? (locale === "zh-Hans" ? "退出专注阅读 (F)" : "Exit focus mode (F)")
    : (locale === "zh-Hans" ? "专注阅读 (F)" : "Focus mode (F)");

  return (
    <button
      aria-label={label}
      aria-pressed={focused}
      className="readerIconButton readerFocusToggle"
      onClick={toggle}
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
    </button>
  );
}
