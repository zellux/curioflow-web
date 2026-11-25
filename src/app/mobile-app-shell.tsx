"use client";

import { type MouseEvent, type ReactNode, useEffect, useState } from "react";

import { NavigationProvider } from "@/app/navigation-state";
import type { SystemLanguage } from "@/app/i18n";

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

const PAGE_TITLE_SELECTOR = ".libraryHeading h1";

// True while the page's own large heading is on screen, so the top bar can leave the
// name to it and fade it in only once the heading scrolls away.
function usePageTitleVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let observed: Element | null = null;
    let frame = 0;
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));

    const sync = () => {
      frame = 0;
      const heading = document.querySelector(PAGE_TITLE_SELECTOR);
      if (heading === observed) return;
      if (observed) intersection.unobserve(observed);
      observed = heading;
      if (heading) intersection.observe(heading);
      else setVisible(false);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    sync();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      intersection.disconnect();
    };
  }, []);

  return visible;
}

export function MobileAppShell({
  addSourceLabel,
  children,
  label,
  locale,
  sidebar
}: {
  addSourceLabel: string;
  children: ReactNode;
  label: ReactNode;
  locale: SystemLanguage;
  sidebar: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitleVisible = usePageTitleVisible();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `curioflow-system-language=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        return;
      }
      if (
        event.key === "/"
        && !event.defaultPrevented
        && !event.isComposing
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"))
        && !document.querySelector("[role='dialog'][aria-modal='true']")
      ) {
        const searchInput = document.querySelector<HTMLInputElement>(".searchShell input[name='q']");
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function openAddSource() {
    setSidebarOpen(false);
    window.dispatchEvent(new CustomEvent(OPEN_ADD_SOURCE_EVENT, { detail: { tab: "url" } }));
  }

  function handleSidebarClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a") || target.closest(".addSourceButton")) {
      setSidebarOpen(false);
    }
  }

  return (
    <NavigationProvider locale={locale}>
      <main className={`appShell${sidebarOpen ? " isSidebarOpen" : ""}`}>
        <div className="mobileTopBar">
          <button aria-expanded={sidebarOpen} aria-label="Menu" onClick={() => setSidebarOpen((open) => !open)} type="button">
            <MenuIcon />
          </button>
          <span className={pageTitleVisible ? "isPageTitleVisible" : undefined}>{label}</span>
          <button aria-label={addSourceLabel} aria-haspopup="dialog" className="globalAddAction mobileAddButton" onClick={openAddSource} type="button">
            <PlusIcon />
            <span className="globalAddActionLabel">{addSourceLabel}</span>
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
    </NavigationProvider>
  );
}
