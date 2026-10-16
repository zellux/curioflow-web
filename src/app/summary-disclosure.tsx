import type { ReactNode } from "react";

export function SummaryDisclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <details className="summaryDisclosure" open><summary>{label}</summary>{children}</details>;
}
