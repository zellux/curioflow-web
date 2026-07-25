"use client";

import { useEffect } from "react";

type ReaderKeyboardNavigationProps = {
  targetId: string;
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}

function isKeyboardActivationTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(target.closest("button, a[href], summary, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch']"));
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

export function ReaderKeyboardNavigation({ targetId }: ReaderKeyboardNavigationProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSpaceKey = event.key === " " || event.key === "Spacebar";

      if (
        event.defaultPrevented
        || event.isComposing
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || (event.shiftKey && !isSpaceKey)
        || isEditableTarget(event.target)
        || (isSpaceKey && isKeyboardActivationTarget(event.target))
        || document.querySelector("[role='dialog'][aria-modal='true']")
      ) {
        return;
      }

      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(event.key)) return;

      const target = document.getElementById(targetId);
      if (!target) return;

      const scroller = getReaderScroller(target);
      const windowScroller = isWindowScroller(scroller);
      const currentTop = windowScroller ? window.scrollY : scroller.scrollTop;
      const viewportHeight = windowScroller ? window.innerHeight : scroller.clientHeight;
      const scrollHeight = windowScroller ? document.documentElement.scrollHeight : scroller.scrollHeight;
      const maximumTop = Math.max(0, scrollHeight - viewportHeight);
      const pageDistance = viewportHeight * 0.9;
      const arrowDistance = 48;
      let nextTop: number;

      switch (event.key) {
        case "ArrowUp":
          nextTop = currentTop - arrowDistance;
          break;
        case "ArrowDown":
          nextTop = currentTop + arrowDistance;
          break;
        case "PageUp":
          nextTop = currentTop - pageDistance;
          break;
        case "PageDown":
          nextTop = currentTop + pageDistance;
          break;
        case "Home":
          nextTop = 0;
          break;
        case "End":
          nextTop = maximumTop;
          break;
        case " ":
        case "Spacebar":
          nextTop = currentTop + (event.shiftKey ? -pageDistance : pageDistance);
          break;
        default:
          return;
      }

      event.preventDefault();
      scroller.scrollTo({ top: Math.max(0, Math.min(maximumTop, nextTop)) });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [targetId]);

  return null;
}
