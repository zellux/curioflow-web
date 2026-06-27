"use client";

import { useEffect } from "react";

type SummaryScrollRestorerProps = {
  itemId: string;
  pending: boolean;
  ready: boolean;
  targetId: string;
};

export function summaryPendingStorageKey(itemId: string) {
  return `curioflow-summary-pending:${itemId}`;
}

function scrollTopFor(target: HTMLElement, scroller: HTMLElement) {
  const targetRect = target.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  return scroller.scrollTop + targetRect.top - scrollerRect.top;
}

export function SummaryScrollRestorer({ itemId, pending, ready, targetId }: SummaryScrollRestorerProps) {
  useEffect(() => {
    const storageKey = summaryPendingStorageKey(itemId);

    if (pending) {
      window.sessionStorage.setItem(storageKey, "1");
      return;
    }

    if (!ready || window.sessionStorage.getItem(storageKey) !== "1") return;

    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;

      const scroller = target.closest<HTMLElement>(".scrollArea");
      if (scroller) {
        scroller.scrollTo({
          top: Math.max(0, scrollTopFor(target, scroller)),
          behavior: "smooth"
        });
        return;
      }

      target.scrollIntoView({ block: "start", behavior: "smooth" });
    });

    const cleanup = window.setTimeout(() => {
      window.sessionStorage.removeItem(storageKey);
    }, 1500);

    return () => window.clearTimeout(cleanup);
  }, [itemId, pending, ready, targetId]);

  return null;
}
