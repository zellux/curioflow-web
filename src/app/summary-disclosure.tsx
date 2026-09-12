"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function SummaryDisclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try { if (ref.current) ref.current.open = localStorage.getItem("curioflow:summary-expanded") !== "false"; } catch { /* Storage is optional. */ }
  }, []);
  return <details className="summaryDisclosure" ref={ref} open onToggle={event => {
    try { localStorage.setItem("curioflow:summary-expanded", String(event.currentTarget.open)); } catch { /* Storage is optional. */ }
  }}><summary>{label}</summary>{children}</details>;
}
