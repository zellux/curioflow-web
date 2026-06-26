"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ReaderProgressProps = {
  itemId: string;
  initialProgress: number;
  initialPositionJson: string;
  initialReadStatus: string;
  targetId: string;
};

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getReaderScroller(target: HTMLElement): HTMLElement | Window {
  return target.closest<HTMLElement>(".scrollArea") ?? window;
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
  targetId
}: ReaderProgressProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(() => clampProgress(initialProgress));
  const readStatusRef = useRef(initialReadStatus);
  const lastSentRef = useRef({ at: Date.now(), progress: clampProgress(initialProgress) });
  const label = useMemo(() => `${Math.round(progress * 100)}% read`, [progress]);

  useEffect(() => {
    if (window.location.hash || initialReadStatus === "done") return;

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
  }, [initialPositionJson, initialReadStatus, targetId]);

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

  return (
    <>
      <div className="readerTopProgress" aria-label={label}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="readerProgress">
        <section className="markDonePanel">
          <div>
            <strong>{label}</strong>
            <span>{readStatusRef.current === "done" ? "Finished" : "Save your place as you read."}</span>
          </div>
          <button type="button" onClick={markDone}>
            Mark as done
          </button>
        </section>
      </div>
    </>
  );
}
