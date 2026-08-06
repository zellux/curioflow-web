"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export const NAVIGATION_START_EVENT = "curioflow:navigation-start";

function isPlainPrimaryClick(event: MouseEvent<HTMLElement>) {
  return event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

export function SidebarNavigation({
  ariaLabel,
  children
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const pendingLink = useRef<HTMLAnchorElement | null>(null);
  const [pending, setPending] = useState(false);

  function clearPending() {
    pendingLink.current?.classList.remove("isPending");
    pendingLink.current = null;
    setPending(false);
  }

  useEffect(() => {
    clearPending();
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;

    const timeout = window.setTimeout(clearPending, 30_000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || !isPlainPrimaryClick(event)) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.download || link.target === "_blank") return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;

    pendingLink.current?.classList.remove("isPending");
    pendingLink.current = link;
    link.classList.add("isPending");
    setPending(true);
    window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT));
  }

  return (
    <aside
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      className={`sidebar${pending ? " isNavigating" : ""}`}
      onClickCapture={handleClick}
    >
      {children}
    </aside>
  );
}

