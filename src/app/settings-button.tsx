"use client";

import type { MouseEvent, ReactNode } from "react";
import { OPEN_SETTINGS_EVENT } from "@/app/settings-overlay-state";

export function SettingsButton({
  children,
  href,
  label
}: {
  children: ReactNode;
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
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
  }

  return (
    <a
      aria-label={label}
      className="sidebarSettingsButton"
      href={href}
      onClick={openSettings}
      title={label}
    >
      {children}
    </a>
  );
}
