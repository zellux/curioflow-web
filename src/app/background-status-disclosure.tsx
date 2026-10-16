"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function BackgroundStatusDisclosure({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const shell = element?.closest<HTMLElement>(".mainShell");
    if (!element || !shell) return;
    const measure = () => shell.style.setProperty("--work-status-height", `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); shell.style.removeProperty("--work-status-height"); };
  }, []);
  return <details className="backgroundStatusDisclosure" ref={ref}>
    <summary><span className="jobStatusDot" aria-hidden="true" /><span>{title}</span><small>{label}</small></summary>
    <div className="backgroundStatusDetails">{children}</div>
  </details>;
}
