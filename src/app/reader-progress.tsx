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
  const lastSentRef = useRef({ at: 0, progress: clampProgress(initialProgress) });
  const label = useMemo(() => `${Math.round(progress * 100)}% read`, [progress]);

  useEffect(() => {
    if (window.location.hash || initialReadStatus === "done") return;

    try {
      const position = JSON.parse(initialPositionJson) as { scrollY?: unknown };
      if (typeof position.scrollY !== "number" || position.scrollY <= 0) return;
      const scrollY = position.scrollY;

      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY });
      });
    } catch {
      return;
    }
  }, [initialPositionJson, initialReadStatus]);

  const sendProgress = useCallback(
    async (nextProgress: number, readStatus?: string) => {
      const body = {
        readingProgress: clampProgress(nextProgress),
        readingPosition: {
          targetId,
          scrollY: Math.round(window.scrollY),
          viewportHeight: window.innerHeight,
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

      const rect = target.getBoundingClientRect();
      const readableHeight = Math.max(1, target.scrollHeight - window.innerHeight * 0.65);
      const nextProgress = clampProgress((window.innerHeight * 0.35 - rect.top) / readableHeight);
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

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
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
    <div className="readerProgress">
      <div aria-label={label}>
        <span style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
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
  );
}
