"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeSystemLanguage, pickLocale } from "@/app/i18n";
import { ITEM_NOTICE_EVENT, type ItemNotice } from "@/app/item-action-form";

const DEFAULT_DISMISS_MS = 3200;
const UNDO_DISMISS_MS = 5000;
const EXIT_ANIMATION_MS = 220;

type NoticeEntry = {
  id: number;
  notice: ItemNotice;
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function ItemNoticeToast() {
  const router = useRouter();
  const [entry, setEntry] = useState<NoticeEntry | null>(null);
  const [exiting, setExiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const activeIdRef = useRef(0);
  const remainingRef = useRef(DEFAULT_DISMISS_MS);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback((targetId?: number) => {
    if (targetId !== undefined && activeIdRef.current !== targetId) return;
    clearExitTimer();
    if (prefersReducedMotion()) {
      setEntry(current => (targetId === undefined || current?.id === targetId ? null : current));
      setExiting(false);
      setHovered(false);
      setFocused(false);
      return;
    }
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setEntry(current => (targetId === undefined || current?.id === targetId ? null : current));
      setExiting(false);
      setHovered(false);
      setFocused(false);
    }, EXIT_ANIMATION_MS);
  }, [clearExitTimer]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ItemNotice>).detail;
      clearExitTimer();
      activeIdRef.current += 1;
      remainingRef.current = detail.undo ? UNDO_DISMISS_MS : DEFAULT_DISMISS_MS;
      setExiting(false);
      setBusy(false);
      setFailed(false);
      setHovered(false);
      setFocused(false);
      setEntry({ id: activeIdRef.current, notice: detail });
    };
    window.addEventListener(ITEM_NOTICE_EVENT, receive);
    return () => {
      window.removeEventListener(ITEM_NOTICE_EVENT, receive);
      clearExitTimer();
    };
  }, [clearExitTimer]);

  const paused = hovered || focused;

  useEffect(() => {
    if (!entry || exiting || busy || paused) return;
    const startedAt = Date.now();
    const delay = Math.max(0, remainingRef.current);
    const timer = setTimeout(() => {
      dismiss(entry.id);
    }, delay);
    return () => {
      clearTimeout(timer);
      const elapsed = Date.now() - startedAt;
      remainingRef.current = Math.max(600, remainingRef.current - elapsed);
    };
  }, [entry, exiting, busy, paused, failed, dismiss]);

  if (!entry) return null;
  const { id, notice } = entry;
  const locale = normalizeSystemLanguage(notice.locale);
  const copy = pickLocale(locale, {
    en: { undoFailed: "Undo failed. Try again.", undo: "Undo", dismiss: "Dismiss notification" },
    "zh-Hans": { undoFailed: "撤销失败，请重试", undo: "撤销", dismiss: "关闭提示" },
    "zh-Hant": { undoFailed: "復原失敗，請重試", undo: "復原", dismiss: "關閉通知" },
    ja: { undoFailed: "元に戻せませんでした。再試行してください。", undo: "元に戻す", dismiss: "通知を閉じる" },
    ko: { undoFailed: "실행 취소에 실패했습니다. 다시 시도해 주세요.", undo: "실행 취소", dismiss: "알림 닫기" }
  });
  return <div
    key={id}
    className={`itemNotice${exiting ? " itemNotice--exiting" : ""}`}
    role="status"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}
  >
    <span>{failed ? copy.undoFailed : notice.message}</span>
    {notice.undo ? <button disabled={busy || exiting} onClick={async () => {
      setBusy(true);
      try {
        await notice.undo?.();
        router.refresh();
        dismiss(id);
      } catch {
        if (activeIdRef.current !== id) return;
        remainingRef.current = UNDO_DISMISS_MS;
        setFailed(true);
      } finally {
        if (activeIdRef.current === id) setBusy(false);
      }
    }}>{busy ? "…" : copy.undo}</button> : null}
    <button aria-label={copy.dismiss} disabled={busy || exiting} onClick={() => dismiss(id)}>×</button>
  </div>;
}
