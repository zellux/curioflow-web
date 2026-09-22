"use client";

import { useNavigationState } from "@/app/navigation-state";

export function NavigationFeedback({ label }: { label: string }) {
  const { pending } = useNavigationState();
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
