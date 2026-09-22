"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { useNavigationState } from "@/app/navigation-state";

export function SidebarNavigation({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  const { pending, navigate } = useNavigationState();
  const pendingLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!pending) {
      pendingLink.current?.classList.remove("isPending");
      pendingLink.current = null;
    }
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    if (link.dataset.navigationFeedback === "false") return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    const href = destination.pathname + destination.search + destination.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (href === current && !pending) return;
    if (destination.hash && destination.pathname === window.location.pathname && destination.search === window.location.search) return;

    // Own the transition so sidebar and progress feedback share its actual lifetime.
    event.preventDefault();
    pendingLink.current?.classList.remove("isPending");
    pendingLink.current = link;
    link.classList.add("isPending");
    navigate(href);
  }

  return (
    <aside aria-busy={pending || undefined} aria-label={ariaLabel}
      className={`sidebar${pending ? " isNavigating" : ""}`} onClickCapture={handleClick}>
      {children}
    </aside>
  );
}
