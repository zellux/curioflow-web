"use client";
import { useLayoutEffect } from "react";

export function LibraryScrollRestorer() {
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".scrollArea");
    if (!scroller) return;
    const key = `curioflow:list-scroll:${location.pathname}${location.search}`;
    try {
      const top = Number(sessionStorage.getItem(key));
      if (top > 0) scroller.scrollTop = top;
    } catch { /* Storage is optional. */ }
    const remember = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href^="/item/"]')) return;
      try { sessionStorage.setItem(key, String(scroller.scrollTop)); } catch { /* Storage is optional. */ }
    };
    scroller.addEventListener("click", remember);
    return () => scroller.removeEventListener("click", remember);
  }, []);
  return null;
}
