"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";

import { pickLocale, type SystemLanguage } from "@/app/i18n";

const READER_TOOLBAR_COPY: Record<SystemLanguage, { returnToTop: string }> = {
  en: { returnToTop: "Return to top" },
  "zh-Hans": { returnToTop: "回到顶部" },
  "zh-Hant": { returnToTop: "回到頂部" },
  ja: { returnToTop: "先頭へ戻る" },
  ko: { returnToTop: "맨 위로" }
};

const UP_REVEAL_DELTA = 14;
const DOWN_HIDE_DELTA = 10;
const FLOAT_START_BUFFER = 24;
const DEFAULT_HIDE_OFFSET = -120;

function getReaderScroller(element: HTMLElement): HTMLElement | Window {
  const scroller = element.closest<HTMLElement>(".scrollArea");
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

function getMaxScrollTop(scroller: HTMLElement | Window) {
  if (isWindowScroller(scroller)) {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

function getScrollerTop(scroller: HTMLElement | Window) {
  return isWindowScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
}

type ReaderToolbarProps = {
  backButton: ReactNode;
  children: ReactNode;
  locale: SystemLanguage;
  showReturnToTop: boolean;
  targetId: string;
};

export function ReaderToolbar({
  backButton,
  children,
  locale,
  showReturnToTop,
  targetId
}: ReaderToolbarProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hideOffset, setHideOffset] = useState<number>(DEFAULT_HIDE_OFFSET);
  const stateRef = useRef({ floating: false, revealed: false });
  const tCopy = pickLocale(locale, READER_TOOLBAR_COPY);

  const setToolbarState = useCallback((nextFloating: boolean, nextRevealed: boolean) => {
    if (stateRef.current.floating === nextFloating && stateRef.current.revealed === nextRevealed) return;
    stateRef.current = { floating: nextFloating, revealed: nextRevealed };
    setFloating(nextFloating);
    setRevealed(nextRevealed);
  }, []);

  useEffect(() => {
    setToolbarState(false, false);

    const toolbar = toolbarRef.current;
    const anchor = anchorRef.current;
    if (!toolbar || !anchor) return;

    const scroller = getReaderScroller(toolbar);
    let lastScrollTop = Math.max(0, Math.min(getMaxScrollTop(scroller), getScrollTop(scroller)));
    let direction: "up" | "down" | null = null;
    let accumulatedDelta = 0;
    let frame: number | null = null;

    const syncHeight = () => {
      const height = Math.ceil(toolbar.offsetHeight);
      if (height > 0) {
        setHideOffset(-(height + 32));
      }
    };

    const handleScroll = () => {
      const rawScrollTop = getScrollTop(scroller);
      const maxScrollTop = getMaxScrollTop(scroller);

      if (rawScrollTop <= 2) {
        lastScrollTop = 0;
        direction = null;
        accumulatedDelta = 0;
        setToolbarState(false, false);
        return;
      }

      // Ignore iOS / macOS rubber-band overscroll past the bottom of the scroll range.
      if (rawScrollTop > maxScrollTop) return;

      const anchorOffset = anchor.getBoundingClientRect().top - getScrollerTop(scroller);
      const toolbarHeight = toolbar.offsetHeight || 56;

      if (anchorOffset >= -2) {
        lastScrollTop = rawScrollTop;
        direction = null;
        accumulatedDelta = 0;
        setToolbarState(false, false);
        return;
      }

      const delta = rawScrollTop - lastScrollTop;
      lastScrollTop = rawScrollTop;
      if (delta === 0) return;

      const nextDirection = delta < 0 ? "up" : "down";
      if (nextDirection !== direction) {
        direction = nextDirection;
        accumulatedDelta = 0;
      }
      accumulatedDelta += Math.abs(delta);

      if (direction === "up") {
        const pastRestingToolbar = anchorOffset < -(toolbarHeight + FLOAT_START_BUFFER);
        if (accumulatedDelta >= UP_REVEAL_DELTA && (pastRestingToolbar || stateRef.current.floating)) {
          setToolbarState(true, true);
        }
        return;
      }

      if (direction === "down" && accumulatedDelta >= DOWN_HIDE_DELTA && stateRef.current.revealed) {
        if (toolbar.querySelector(".readerMore[data-open='true']")) return;
        setToolbarState(true, false);
      }
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        handleScroll();
      });
    };

    const resizeObserver = new ResizeObserver(syncHeight);
    syncHeight();
    resizeObserver.observe(toolbar);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [setToolbarState, targetId]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const toolbar = toolbarRef.current;
    const anchor = anchorRef.current;
    if (!toolbar || !anchor) return;
    if (event.target instanceof Element) {
      const backButton = event.target.closest<HTMLElement>(".readerBackButton");
      if (backButton && window.getComputedStyle(backButton).position === "fixed") return;
    }
    const scroller = getReaderScroller(toolbar);
    const anchorOffset = anchor.getBoundingClientRect().top - getScrollerTop(scroller);
    if (anchorOffset < -2) {
      setToolbarState(true, true);
    }
  }, [setToolbarState]);

  const handleReturnToTop = useCallback(() => {
    const target = document.getElementById(targetId) ?? toolbarRef.current;
    const scroller = target ? getReaderScroller(target) : window;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [targetId]);

  return (
    <>
      <div aria-hidden="true" className="readerToolbarAnchor" ref={anchorRef} />
      <div
        className={`readerToolbar${floating ? " isFloating" : ""}${revealed ? " isRevealed" : ""}`}
        data-floating={floating ? "true" : undefined}
        data-revealed={revealed ? "true" : undefined}
        onFocusCapture={handleFocusCapture}
        ref={toolbarRef}
        style={{ "--reader-toolbar-hide-offset": `${hideOffset}px` } as CSSProperties}
      >
        {backButton}
        <div className="readerToolbarActions">
          {showReturnToTop && floating ? (
            <button
              aria-label={tCopy.returnToTop}
              className="readerIconButton readerReturnToTopButton"
              onClick={handleReturnToTop}
              title={tCopy.returnToTop}
              type="button"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true">
                <path d="M5 4h14M12 20V8M7 13l5-5 5 5" />
              </svg>
            </button>
          ) : null}
          {children}
        </div>
      </div>
    </>
  );
}
