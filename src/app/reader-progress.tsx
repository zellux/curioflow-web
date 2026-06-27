"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemLanguage } from "@/app/i18n";

type ReaderProgressProps = {
  itemId: string;
  initialProgress: number;
  initialPositionJson: string;
  initialReadStatus: string;
  locale?: SystemLanguage;
  readTime: string;
  skipInitialRestoreKey?: string;
  targetId: string;
};

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getReaderScroller(target: HTMLElement): HTMLElement | Window {
  const scroller = target.closest<HTMLElement>(".scrollArea");
  if (!scroller) return window;

  const overflowY = window.getComputedStyle(scroller).overflowY;
  if (overflowY === "visible" || overflowY === "clip") return window;

  return scroller;
}

function isWindowScroller(scroller: HTMLElement | Window): scroller is Window {
  return scroller === window;
}

function getScrollTop(scroller: HTMLElement | Window) {
  return isWindowScroller(scroller) ? window.scrollY : scroller.scrollTop;
}

function getViewportHeight(scroller: HTMLElement | Window) {
  return isWindowScroller(scroller) ? window.innerHeight : scroller.clientHeight;
}

export function ReaderProgress({
  itemId,
  initialProgress,
  initialPositionJson,
  initialReadStatus,
  locale = "en",
  readTime,
  skipInitialRestoreKey,
  targetId
}: ReaderProgressProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(() => clampProgress(initialProgress));
  const readStatusRef = useRef(initialReadStatus);
  const lastSentRef = useRef({ at: Date.now(), progress: clampProgress(initialProgress) });
  const isDone = progress >= 0.995 || readStatusRef.current === "done";
  const progressLabel = useMemo(() => {
    if (isDone) return locale === "zh-Hans" ? "已完成" : "finished";
    if (progress > 0.02) return locale === "zh-Hans" ? `已读 ${Math.round(progress * 100)}%` : `${Math.round(progress * 100)}% read`;
    return locale === "zh-Hans" ? "未开始" : "not started";
  }, [isDone, locale, progress]);
  const ariaLabel = `${readTime} · ${progressLabel}`;
  const progressForDisplay = isDone ? 1 : progress;
  const progressPercent = Math.round(progressForDisplay * 100);
  const showProgressBubble = progress > 0.01 || isDone;

  useEffect(() => {
    if (window.location.hash || initialReadStatus === "done") return;
    if (skipInitialRestoreKey && window.sessionStorage.getItem(skipInitialRestoreKey) === "1") return;

    try {
      const position = JSON.parse(initialPositionJson) as { scrollY?: unknown };
      if (typeof position.scrollY !== "number" || position.scrollY <= 0) return;
      const scrollY = position.scrollY;

      requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        const scroller = target ? getReaderScroller(target) : window;
        scroller.scrollTo({ top: scrollY });
      });
    } catch {
      return;
    }
  }, [initialPositionJson, initialReadStatus, skipInitialRestoreKey, targetId]);

  const sendProgress = useCallback(
    async (nextProgress: number, readStatus?: string) => {
      const target = document.getElementById(targetId);
      const scroller = target ? getReaderScroller(target) : window;
      const body = {
        readingProgress: clampProgress(nextProgress),
        readingPosition: {
          targetId,
          scrollY: Math.round(getScrollTop(scroller)),
          viewportHeight: getViewportHeight(scroller),
          savedAt: new Date().toISOString()
        },
        ...(readStatus ? { readStatus } : {})
      };

      if (readStatus) readStatusRef.current = readStatus;

      await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true
      });
    },
    [itemId, targetId]
  );

  useEffect(() => {
    const update = () => {
      const target = document.getElementById(targetId);
      if (!target) return;

      const scroller = getReaderScroller(target);
      const viewportHeight = getViewportHeight(scroller);
      const readableHeight = Math.max(1, target.scrollHeight - viewportHeight * 0.65);
      let nextProgress = 0;

      if (isWindowScroller(scroller)) {
        const rect = target.getBoundingClientRect();
        nextProgress = clampProgress((window.innerHeight * 0.35 - rect.top) / readableHeight);
      } else {
        const rect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const targetTop = rect.top - scrollerRect.top + scroller.scrollTop;
        const distance = scroller.scrollTop - targetTop + scroller.clientHeight * 0.35;
        nextProgress = clampProgress(distance / readableHeight);
      }

      setProgress(nextProgress);

      const now = Date.now();
      const shouldMarkReading = readStatusRef.current === "unread" && nextProgress >= 0.08;
      const shouldPersist =
        shouldMarkReading ||
        now - lastSentRef.current.at > 2500 ||
        Math.abs(nextProgress - lastSentRef.current.progress) >= 0.08;

      if (!shouldPersist) return;

      lastSentRef.current = { at: now, progress: nextProgress };
      void sendProgress(nextProgress, shouldMarkReading ? "reading" : undefined);
    };

    const target = document.getElementById(targetId);
    const scroller = target ? getReaderScroller(target) : window;

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sendProgress, targetId]);

  const markDone = async () => {
    setProgress(1);
    lastSentRef.current = { at: Date.now(), progress: 1 };
    await sendProgress(1, "done");
    router.refresh();
  };

  const resetProgress = async () => {
    const target = document.getElementById(targetId);
    const scroller = target ? getReaderScroller(target) : window;
    scroller.scrollTo({ top: 0 });
    setProgress(0);
    lastSentRef.current = { at: Date.now(), progress: 0 };
    await sendProgress(0, "unread");
    router.refresh();
  };

  return (
    <>
      <button
        aria-label={locale === "zh-Hans" ? "重置阅读进度并回到顶部" : "Reset progress and return to top"}
        className={`readerProgressBubble ${showProgressBubble ? "isVisible" : ""}`}
        onClick={resetProgress}
        style={{ background: `conic-gradient(var(--accent) ${(progressForDisplay * 360).toFixed(1)}deg, var(--line) 0deg)` }}
        title={locale === "zh-Hans" ? "重置阅读进度并回到顶部" : "Reset progress and return to top"}
        type="button"
      >
        <span className="readerProgressBubbleInner">
          <span>{progressPercent}</span>%
        </span>
      </button>
      <div className="readerProgressControls">
        <span className="readerProgressMeta">{ariaLabel}</span>
        <div className="readerProgressActions">
          {progress > 0.02 || isDone ? (
            <button className="readerProgressResetButton" type="button" onClick={resetProgress}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4" />
              </svg>
              {locale === "zh-Hans" ? "重置" : "Reset"}
            </button>
          ) : null}
          {!isDone ? (
            <button className="readerProgressDoneButton" type="button" onClick={markDone}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {locale === "zh-Hans" ? "标记完成" : "Mark done"}
            </button>
          ) : (
            <span className="readerProgressDoneLabel">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {locale === "zh-Hans" ? "完成" : "Done"}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
