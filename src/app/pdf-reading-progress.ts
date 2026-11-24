"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function savedPdfPage(position: string) {
  try {
    const { type, page } = JSON.parse(position);
    if (type === "pdf" && Number.isSafeInteger(page) && page > 0) return page as number;
  } catch {
    // Older items may not have a page position.
  }
  return 1;
}

export function usePdfReadingProgress(itemId: string, initialProgress: number) {
  const [progress, setProgress] = useState(initialProgress);
  const [saveFailed, setSaveFailed] = useState(false);
  const furthest = useRef(initialProgress);
  const pending = useRef(Promise.resolve());
  const revision = useRef(0);
  const resetting = useRef(false);

  const save = useCallback((page: number, pageCount: number) => {
    if (resetting.current) return;
    const pageProgress = page === pageCount ? 1 : Math.min(0.97, page / pageCount);
    const readingProgress = Math.max(furthest.current, pageProgress);
    furthest.current = readingProgress;
    setProgress(readingProgress);
    setSaveFailed(false);
    const current = ++revision.current;

    pending.current = pending.current.then(async () => {
      if (resetting.current || current !== revision.current) return;
      try {
        const response = await fetch(`/api/items/${itemId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ readingProgress, readingPosition: { type: "pdf", page } }),
          keepalive: true
        });
        if (!response.ok) throw new Error("Unable to save PDF progress");
      } catch {
        if (current === revision.current) setSaveFailed(true);
      }
    });
  }, [itemId]);

  useEffect(() => {
    const reset = (event: Event) => {
      resetting.current = true;
      (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil(pending.current);
    };
    const cancel = () => { resetting.current = false; };
    window.addEventListener("curioflow:reading-reset", reset);
    window.addEventListener("curioflow:reading-reset-cancel", cancel);
    return () => {
      window.removeEventListener("curioflow:reading-reset", reset);
      window.removeEventListener("curioflow:reading-reset-cancel", cancel);
    };
  }, []);

  return { progress, save, saveFailed };
}
