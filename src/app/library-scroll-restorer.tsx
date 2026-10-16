"use client";
import { useLayoutEffect, useRef } from "react";

export function LibraryScrollRestorer() {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // During streaming the router may retain another route's hidden scroller.
    const scroller = marker.current?.closest<HTMLElement>(".scrollArea");
    if (!scroller) return;
    const overflow = getComputedStyle(scroller).overflowY;
    const usesWindow = overflow === "visible" || overflow === "clip";
    const key = `curioflow:list-scroll:${location.pathname}${location.search}`;
    try {
      const top = Number(sessionStorage.getItem(key));
      if (top > 0) {
        if (usesWindow) window.scrollTo({ top });
        else scroller.scrollTop = top;
      }
    } catch { /* Storage is optional. */ }
    const remember = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href^="/item/"]')) return;
      try { sessionStorage.setItem(key, String(usesWindow ? window.scrollY : scroller.scrollTop)); } catch { /* Storage is optional. */ }
    };
    scroller.addEventListener("click", remember);
    return () => scroller.removeEventListener("click", remember);
  }, []);
  return <span hidden aria-hidden="true" ref={marker} />;
}
