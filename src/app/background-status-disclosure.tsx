"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const DISMISS_STORAGE_KEY = "curioflow-background-status-dismissed";
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;

function readDismissedUntil() {
  try {
    const value = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function BackgroundStatusDisclosure({
  title,
  label,
  dismissLabel,
  hasIssue,
  children
}: {
  title: string;
  label: string;
  dismissLabel: string;
  hasIssue: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [dismissed, setDismissed] = useState(false);

  useLayoutEffect(() => {
    if (hasIssue && readDismissedUntil() > Date.now()) setDismissed(true);
  }, [hasIssue]);

  useLayoutEffect(() => {
    const element = ref.current;
    const shell = element?.closest<HTMLElement>(".mainShell");
    if (!element || !shell) return;
    const measure = () => shell.style.setProperty("--work-status-height", `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); shell.style.removeProperty("--work-status-height"); };
  }, [dismissed]);

  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch {
      // Dismissal still applies for this page view without storage.
    }
    setDismissed(true);
  }

  return <details className={`backgroundStatusDisclosure ${hasIssue ? "hasIssue" : "isActive"}`} ref={ref}>
    <summary>
      <span className="jobStatusDot" aria-hidden="true" />
      <span>{title}</span>
      <small>{label}</small>
      {hasIssue ? (
        <button
          aria-label={dismissLabel}
          className="backgroundStatusDismiss"
          onClick={(event) => { event.preventDefault(); dismiss(); }}
          title={dismissLabel}
          type="button"
        >×</button>
      ) : null}
    </summary>
    <div className="backgroundStatusDetails">{children}</div>
  </details>;
}
