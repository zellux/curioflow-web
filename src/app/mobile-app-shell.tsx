"use client";

import { type MouseEvent, type ReactNode, useEffect, useState } from "react";

const OPEN_ADD_SOURCE_EVENT = "curioflow:open-add-source";

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function MobileAppShell({
  addSourceLabel,
  children,
  label,
  sidebar
}: {
  addSourceLabel: string;
  children: ReactNode;
  label: string;
  sidebar: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function openAddSource() {
    setSidebarOpen(false);
    window.dispatchEvent(new CustomEvent(OPEN_ADD_SOURCE_EVENT, { detail: { tab: "rss" } }));
  }

  function handleSidebarClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a") || target.closest(".addSourceButton")) {
      setSidebarOpen(false);
    }
  }

  return (
    <main className={`appShell${sidebarOpen ? " isSidebarOpen" : ""}`}>
      <div className="mobileTopBar">
        <button aria-expanded={sidebarOpen} aria-label="Menu" onClick={() => setSidebarOpen((open) => !open)} type="button">
          <MenuIcon />
        </button>
        <span>{label}</span>
        <button aria-label={addSourceLabel} className="mobileAddButton" onClick={openAddSource} type="button">
          <PlusIcon />
        </button>
      </div>
      <button className="sidebarScrim" onClick={() => setSidebarOpen(false)} type="button" aria-label="Close menu" />
      <div className="sidebarSlot" onClickCapture={handleSidebarClick}>
        <button className="sidebarCloseButton" onClick={() => setSidebarOpen(false)} type="button" aria-label="Close menu">
          <CloseIcon />
        </button>
        {sidebar}
      </div>
      {children}
    </main>
  );
}
