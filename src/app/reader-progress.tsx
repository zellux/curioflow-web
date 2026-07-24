"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemLanguage } from "@/app/i18n";

const PROGRESS_SAVE_DELAY_MS = 800;

type ReaderProgressProps = {
  archiveAction?: (formData: FormData) => void | Promise<void>;
  archived?: boolean;
  canArchive?: boolean;
  itemId: string;
  initialProgress: number;
  initialPositionJson: string;
  locale?: SystemLanguage;
  readTime: string;
  returnTo: string;
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
  archiveAction,
  archived = false,
  canArchive = false,
  itemId,
  initialProgress,
  initialPositionJson,
  locale = "en",
  readTime,
  returnTo,
  skipInitialRestoreKey,
  targetId
}: ReaderProgressProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(() => clampProgress(initialProgress));
  const latestReadingRef = useRef({
    progress: clampProgress(initialProgress),
    scrollY: 0,
    viewportHeight: 0
  });
  const restoredItemIdRef = useRef<string | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);
  const progressDirtyRef = useRef(false);
  const isDone = progress >= 0.98;
  const progressLabel = useMemo(() => {
    if (isDone) return locale === "zh-Hans" ? "已完成" : "finished";
    if (progress > 0.02) return locale === "zh-Hans" ? `已读 ${Math.round(progress * 100)}%` : `${Math.round(progress * 100)}% read`;
    return locale === "zh-Hans" ? "未开始" : "not started";
  }, [isDone, locale, progress]);
  const ariaLabel = `${readTime} · ${progressLabel}`;
  const progressForDisplay = isDone ? 1 : progress;
  const progressPercent = Math.round(progressForDisplay * 100);
  const showProgressBubble = progress > 0.01 || isDone;
  const showFinishAction = isDone && Boolean(archived || (canArchive && archiveAction));
  const archiveAndReturnLabel = locale === "zh-Hans" ? "归档并返回" : "Archive & return";
  const backToLibraryLabel = locale === "zh-Hans" ? "返回资料库" : "Back to Library";

  useEffect(() => {
    if (restoredItemIdRef.current === itemId) return;
    restoredItemIdRef.current = itemId;

    if (window.location.hash) return;
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
  }, [initialPositionJson, itemId, skipInitialRestoreKey, targetId]);

  const sendProgress = useCallback(
    async (reading: { progress: number; scrollY: number; viewportHeight: number }) => {
      const body = {
        readingProgress: clampProgress(reading.progress),
        readingPosition: {
          targetId,
          scrollY: Math.round(reading.scrollY),
          viewportHeight: reading.viewportHeight,
          savedAt: new Date().toISOString()
        }
      };

      await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true
      });
    },
    [itemId, targetId]
  );

  const persistProgress = useCallback(
    async (force = false) => {
      if (progressSaveTimerRef.current !== null) {
        window.clearTimeout(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }
      if (!force && !progressDirtyRef.current) return;

      progressDirtyRef.current = false;
      try {
        await sendProgress({ ...latestReadingRef.current });
      } catch {
        progressDirtyRef.current = true;
      }
    },
    [sendProgress]
  );

  const scheduleProgressSave = useCallback(() => {
    progressDirtyRef.current = true;
    if (progressSaveTimerRef.current !== null) {
      window.clearTimeout(progressSaveTimerRef.current);
    }
    progressSaveTimerRef.current = window.setTimeout(() => {
      progressSaveTimerRef.current = null;
      void persistProgress();
    }, PROGRESS_SAVE_DELAY_MS);
  }, [persistProgress]);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const scroller = getReaderScroller(target);
    let frame: number | null = null;
    let geometry = {
      readableHeight: 1,
      targetTop: 0,
      viewportHeight: getViewportHeight(scroller)
    };

    const update = (shouldPersist: boolean) => {
      const scrollY = getScrollTop(scroller);
      const nextProgress = clampProgress(
        (scrollY - geometry.targetTop + geometry.viewportHeight * 0.35) / geometry.readableHeight
      );
      latestReadingRef.current = {
        progress: nextProgress,
        scrollY,
        viewportHeight: geometry.viewportHeight
      };

      const displayProgress = Math.round(nextProgress * 100) / 100;
      setProgress((current) => (current === displayProgress ? current : displayProgress));
      if (shouldPersist) scheduleProgressSave();
    };

    const refreshGeometry = () => {
      const viewportHeight = getViewportHeight(scroller);
      const scrollY = getScrollTop(scroller);
      const targetRect = target.getBoundingClientRect();
      const scrollerTop = isWindowScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
      geometry = {
        readableHeight: Math.max(1, target.scrollHeight - viewportHeight * 0.65),
        targetTop: scrollY + targetRect.top - scrollerTop,
        viewportHeight
      };
      update(false);
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        update(true);
      });
    };

    const resizeObserver = new ResizeObserver(refreshGeometry);
    refreshGeometry();
    resizeObserver.observe(target);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", refreshGeometry);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", refreshGeometry);
    };
  }, [scheduleProgressSave, targetId]);

  useEffect(() => {
    const flushProgress = () => void persistProgress();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };

    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      void persistProgress();
    };
  }, [persistProgress]);

  const resetProgress = async () => {
    const target = document.getElementById(targetId);
    const scroller = target ? getReaderScroller(target) : window;
    scroller.scrollTo({ top: 0 });
    latestReadingRef.current = {
      progress: 0,
      scrollY: 0,
      viewportHeight: getViewportHeight(scroller)
    };
    progressDirtyRef.current = true;
    setProgress(0);
    await persistProgress(true);
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
          <span className="readerProgressBubblePercent"><span>{progressPercent}</span>%</span>
          <svg className="readerProgressBubbleIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>
      </button>
      {showFinishAction ? (
        <div className="readerFinishAction" aria-live="polite">
          {archived ? (
            <a className="readerFinishButton" href={returnTo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
              {backToLibraryLabel}
            </a>
          ) : archiveAction ? (
            <form action={archiveAction}>
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="readerFinishButton" type="submit">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4" />
                </svg>
                {archiveAndReturnLabel}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      <div className="readerProgressControls">
        <span className="readerProgressInlineBar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progressForDisplay})` }} />
        </span>
        <span className="readerProgressMeta" aria-label={ariaLabel}>{readTime}</span>
      </div>
    </>
  );
}
