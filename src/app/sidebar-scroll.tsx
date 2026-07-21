"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

const SIDEBAR_SCROLL_STORAGE_KEY = "curioflow-sidebar-scroll-top";
let cachedScrollTop = 0;
let hasCachedScrollTop = false;

function readScrollTop() {
  if (hasCachedScrollTop) return cachedScrollTop;

  try {
    const stored = Number.parseFloat(window.sessionStorage.getItem(SIDEBAR_SCROLL_STORAGE_KEY) ?? "0");
    cachedScrollTop = Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    cachedScrollTop = 0;
  }

  hasCachedScrollTop = true;
  return cachedScrollTop;
}

function saveScrollTop(scrollTop: number) {
  cachedScrollTop = scrollTop;
  hasCachedScrollTop = true;

  try {
    window.sessionStorage.setItem(SIDEBAR_SCROLL_STORAGE_KEY, String(scrollTop));
  } catch {
    return;
  }
}

export function SidebarScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.scrollTop = readScrollTop();
  }, []);

  return (
    <div
      className="sidebarScroll"
      onScroll={(event) => saveScrollTop(event.currentTarget.scrollTop)}
      ref={scrollRef}
    >
      {children}
    </div>
  );
}
