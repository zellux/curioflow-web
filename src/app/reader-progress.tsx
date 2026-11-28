"use client";
import { ItemActionForm } from "@/app/item-action-form";
import { unarchiveItemAction } from "@/app/actions";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { pickLocale, type SystemLanguage } from "@/app/i18n";
import { notifyReadStateChanged } from "@/app/read-state-events";
import { READING_COMPLETION_THRESHOLD } from "@/server/item-state";

const READER_PROGRESS_COPY: Record<SystemLanguage, {
  archiveAndNext: string;
  archiveAndReturn: string;
  archived: string;
  archiving: string;
  backToList: string;
  finished: string;
  notStarted: string;
  percentRead: (percent: number) => string;
  readingProgress: string;
  returnToTop: string;
}> = {
  en: {
    archiveAndNext: "Archive & read next",
    archiveAndReturn: "Archive & return",
    archived: "Archived",
    archiving: "Archiving…",
    backToList: "Back to list",
    finished: "finished",
    notStarted: "not started",
    percentRead: (percent) => `${percent}% read`,
    readingProgress: "Reading progress",
    returnToTop: "Return to top"
  },
  "zh-Hans": {
    archiveAndNext: "归档并读下一篇",
    archiveAndReturn: "归档并返回",
    archived: "已归档",
    archiving: "归档中…",
    backToList: "返回列表",
    finished: "已完成",
    notStarted: "未开始",
    percentRead: (percent) => `已读 ${percent}%`,
    readingProgress: "阅读进度",
    returnToTop: "回到顶部"
  },
  "zh-Hant": {
    archiveAndNext: "封存並讀下一篇",
    archiveAndReturn: "封存並返回",
    archived: "已封存",
    archiving: "封存中…",
    backToList: "返回清單",
    finished: "已完成",
    notStarted: "未開始",
    percentRead: (percent) => `已讀 ${percent}%`,
    readingProgress: "閱讀進度",
    returnToTop: "回到頂部"
  },
  ja: {
    archiveAndNext: "アーカイブして次を読む",
    archiveAndReturn: "アーカイブして戻る",
    archived: "アーカイブしました",
    archiving: "アーカイブ中…",
    backToList: "一覧へ戻る",
    finished: "読了",
    notStarted: "未読",
    percentRead: (percent) => `${percent}% 既読`,
    readingProgress: "読書進捗",
    returnToTop: "先頭へ戻る"
  },
  ko: {
    archiveAndNext: "보관하고 다음 글 읽기",
    archiveAndReturn: "보관하고 돌아가기",
    archived: "보관됨",
    archiving: "보관 중…",
    backToList: "목록으로 돌아가기",
    finished: "완독",
    notStarted: "읽기 전",
    percentRead: (percent) => `${percent}% 읽음`,
    readingProgress: "읽기 진행률",
    returnToTop: "맨 위로"
  }
};

const PROGRESS_SAVE_DELAY_MS = 800;

type ReaderProgressProps = {
  archiveAction?: (formData: FormData) => Promise<void>;
  archived?: boolean;
  canArchive?: boolean;
  itemId: string;
  initialProgress: number;
  initialPositionJson: string;
  locale?: SystemLanguage;
  readTime: string;
  returnTo: string;
  nextHref?: string;
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
  nextHref,
  targetId
}: ReaderProgressProps) {
  const [progress, setProgress] = useState(() => clampProgress(initialProgress));
  const [progressLineContainer, setProgressLineContainer] = useState<HTMLElement | null>(null);
  const latestReadingRef = useRef({
    progress: clampProgress(initialProgress),
    scrollY: 0,
    viewportHeight: 0
  });
  const restoredItemIdRef = useRef<string | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);
  const progressDirtyRef = useRef(false);
  const resetRequestedRef = useRef(false);
  const inFlightRef = useRef(new Set<Promise<void>>());
  const isDone = progress >= 0.98;
  const pCopy = pickLocale(locale, READER_PROGRESS_COPY);
  const progressLabel = useMemo(() => {
    if (isDone) return pCopy.finished;
    if (progress > 0.02) return pCopy.percentRead(Math.round(progress * 100));
    return pCopy.notStarted;
  }, [isDone, pCopy, progress]);
  const ariaLabel = `${readTime} · ${progressLabel}`;
  const progressForDisplay = isDone ? 1 : progress;
  const progressPercent = Math.round(progressForDisplay * 100);
  const showFinishAction = isDone && Boolean(archived || (canArchive && archiveAction));
  const archiveAndReturnLabel = nextHref ? pCopy.archiveAndNext : pCopy.archiveAndReturn;
  const backToLibraryLabel = pCopy.backToList;

  useEffect(() => {
    if (restoredItemIdRef.current === itemId) return;
    restoredItemIdRef.current = itemId;

    if (window.location.hash) return;

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
  }, [initialPositionJson, itemId, targetId]);

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

      const response = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true
      });
      if (!response.ok) throw new Error("Could not save reading progress");
      if (body.readingProgress >= READING_COMPLETION_THRESHOLD) notifyReadStateChanged();
    },
    [itemId, targetId]
  );

  const persistProgress = useCallback(
    async (force = false) => {
      if (progressSaveTimerRef.current !== null) {
        window.clearTimeout(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }
      if (resetRequestedRef.current || (!force && !progressDirtyRef.current)) return;

      progressDirtyRef.current = false;
      const saving = sendProgress({ ...latestReadingRef.current });
      inFlightRef.current.add(saving);
      try { await saving; }
      catch { progressDirtyRef.current = true; }
      finally { inFlightRef.current.delete(saving); }
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

    setProgressLineContainer(target.closest<HTMLElement>(".mainShell") ?? document.getElementById("main-content"));

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
        progress: Math.max(latestReadingRef.current.progress, nextProgress),
        scrollY,
        viewportHeight: geometry.viewportHeight
      };

      const displayProgress = Math.round(latestReadingRef.current.progress * 100) / 100;
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
    const resetReading = (event: Event) => {
      resetRequestedRef.current = true; progressDirtyRef.current = false;
      (event as CustomEvent<{ waitUntil: (promise: Promise<unknown>) => void }>).detail.waitUntil(Promise.allSettled([...inFlightRef.current]));
    };
    const cancelReset = () => { resetRequestedRef.current = false; };
    window.addEventListener("curioflow:reading-reset-cancel", cancelReset);
    window.addEventListener("curioflow:reading-reset", resetReading);
    const flushProgress = () => void persistProgress();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };

    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("curioflow:reading-reset", resetReading);
      window.removeEventListener("curioflow:reading-reset-cancel", cancelReset);
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      void persistProgress();
    };
  }, [persistProgress]);

  const progressLine = (
    <div
      aria-label={pCopy.readingProgress}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progressPercent}
      className="readerProgressLine"
      role="progressbar"
    >
      <span style={{ transform: `scaleX(${progressForDisplay})` }} />
    </div>
  );

  return (
    <>
      {progressLineContainer ? createPortal(progressLine, progressLineContainer) : null}
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
            <ItemActionForm action={archiveAction} undoAction={unarchiveItemAction} values={{ itemId }}
              locale={locale} nextHref={nextHref ?? returnTo} className="readerFinishButton"
              message={pCopy.archived} label={archiveAndReturnLabel}
              pendingChildren={<>
                <svg className="readerFinishSpinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>{pCopy.archiving}</span>
              </>}>
              {archiveAndReturnLabel}
            </ItemActionForm>
          ) : null}
        </div>
      ) : null}
      <div className="readerProgressControls">
        <span className="readerProgressMeta" aria-label={ariaLabel}>{readTime}</span>
      </div>
    </>
  );
}

export function ReaderReturnToTopButton({
  locale = "en",
  targetId
}: {
  locale?: SystemLanguage;
  targetId: string;
}) {
  const [atTop, setAtTop] = useState(true);
  const pCopy = pickLocale(locale, READER_PROGRESS_COPY);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const scroller = getReaderScroller(target);
    const sync = () => setAtTop(getScrollTop(scroller) <= 8);
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    return () => scroller.removeEventListener("scroll", sync);
  }, [targetId]);

  const returnToTop = () => {
    const target = document.getElementById(targetId);
    const scroller = target ? getReaderScroller(target) : window;
    scroller.scrollTo({ top: 0 });
  };

  return (
    <button
      className="readerMoreItem readerReturnToTopItem"
      data-close-menu=""
      disabled={atTop}
      onClick={returnToTop}
      role="menuitem"
      type="button"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true">
        <path d="M5 4h14M12 20V8M7 13l5-5 5 5" />
      </svg>
      <span>{pCopy.returnToTop}</span>
    </button>
  );
}
