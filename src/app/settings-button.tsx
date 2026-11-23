"use client";

import type { MouseEvent, ReactNode } from "react";
import { OPEN_SETTINGS_EVENT } from "@/app/settings-overlay-state";

export function SettingsButton({
  children,
  className = "sidebarSettingsButton",
  importTarget,
  href,
  label
}: {
  children: ReactNode;
  className?: string;
  importTarget?: "newsletter";
  href: string;
  label: string;
}) {
  function openSettings(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: importTarget ? { tab: "import", target: importTarget } : undefined }));
  }

  return (
    <a
      aria-label={label}
      className={className}
      data-navigation-feedback="false"
      href={href}
      onClick={openSettings}
      title={label}
    >
      {children}
    </a>
  );
}
