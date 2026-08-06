"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NAVIGATION_START_EVENT } from "@/app/sidebar-navigation";

export function NavigationFeedback({ label }: { label: string }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function showFeedback() {
      setPending(true);
    }

    window.addEventListener(NAVIGATION_START_EVENT, showFeedback);
    return () => window.removeEventListener(NAVIGATION_START_EVENT, showFeedback);
  }, []);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;

    const timeout = window.setTimeout(() => setPending(false), 30_000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  return (
    <div
      aria-hidden={!pending}
      aria-label={label}
      aria-valuetext={pending ? label : undefined}
      className={`navigationProgress${pending ? " isVisible" : ""}`}
      role="progressbar"
    >
      <span />
    </div>
  );
}

