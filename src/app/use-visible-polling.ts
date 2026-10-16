"use client";

import { useEffect } from "react";

export function useVisiblePolling(poll: (signal: AbortSignal) => Promise<void>, delay: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

    async function tick() {
      if (disposed || running) return;
      if (document.visibilityState === "hidden") return;
      running = true;
      controller = new AbortController();
      try {
        await poll(controller.signal);
      } catch {
        // Retain the last usable UI on transient network failures.
      } finally {
        running = false;
        if (!disposed) timer = setTimeout(tick, delay);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void tick();
    }
    timer = setTimeout(tick, delay);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [poll, delay, enabled]);
}
