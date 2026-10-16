"use client";

import { useEffect, type RefObject } from "react";

export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initialFocus?: string) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertElements: Array<{ element: HTMLElement; inert: boolean }> = [];
    for (let current: HTMLElement | null = dialog; current?.parentElement && current !== document.body; current = current.parentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling !== current && sibling instanceof HTMLElement) {
          inertElements.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), textarea, select, [tabindex]'))
      .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") && element.getClientRects().length > 0);
    const initial = initialFocus ? Array.from(dialog.querySelectorAll<HTMLElement>(initialFocus)).find(element => element.getClientRects().length > 0) : null;
    (initial ?? focusable()[0])?.focus({ preventScroll: true });
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      for (const { element, inert } of inertElements) element.inert = inert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, [ref, open, onClose, initialFocus]);
}
