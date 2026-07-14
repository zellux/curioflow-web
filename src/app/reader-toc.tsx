"use client";

import { useEffect, useState } from "react";
import type { ReaderTocItem } from "@/server/reader/rendering";
import type { SystemLanguage } from "@/app/i18n";

type ReaderTocProps = {
  items: ReaderTocItem[];
  locale?: SystemLanguage;
  targetId: string;
};

function getReaderScroller(target: HTMLElement): HTMLElement | Window {
  const scroller = target.closest<HTMLElement>(".scrollArea");
  if (!scroller) return window;

  const overflowY = window.getComputedStyle(scroller).overflowY;
  if (overflowY === "visible" || overflowY === "clip") return window;

  return scroller;
}

function isWindowScroller(scroller: HTMLElement | Window): scroller is Window {
  return scroller === window;
}

function getScrollTop(scroller: HTMLElement | Window) {
  return isWindowScroller(scroller) ? window.scrollY : scroller.scrollTop;
}

export function ReaderToc({ items, locale = "en", targetId }: ReaderTocProps) {
  const [activeId, setActiveId] = useState(() => items[0]?.id ?? "");

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || items.length === 0) return;

    const scroller = getReaderScroller(target);
    const mobileQuery = window.matchMedia("(max-width: 900px)");
    let frame: number | null = null;
    let listening = false;
    let sectionPositions: Array<{ id: string; top: number }> = [];

    const updateActiveSection = () => {
      const marker = getScrollTop(scroller) + 140;
      let currentId = sectionPositions[0]?.id ?? items[0].id;
      for (const section of sectionPositions) {
        if (section.top > marker) break;
        currentId = section.id;
      }
      setActiveId((current) => (current === currentId ? current : currentId));
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateActiveSection();
      });
    };

    const refreshSectionPositions = () => {
      const scrollY = getScrollTop(scroller);
      const scrollerTop = isWindowScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
      sectionPositions = items.flatMap((item) => {
        const section = document.getElementById(item.id);
        return section ? [{ id: item.id, top: scrollY + section.getBoundingClientRect().top - scrollerTop }] : [];
      });
      updateActiveSection();
    };

    const resizeObserver = new ResizeObserver(refreshSectionPositions);
    const stopListening = () => {
      if (!listening) return;
      listening = false;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", refreshSectionPositions);
    };
    const startListening = () => {
      if (listening || mobileQuery.matches) return;
      listening = true;
      refreshSectionPositions();
      resizeObserver.observe(target);
      scroller.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", refreshSectionPositions);
    };
    const syncListening = () => {
      if (mobileQuery.matches) stopListening();
      else startListening();
    };

    mobileQuery.addEventListener("change", syncListening);
    syncListening();

    return () => {
      mobileQuery.removeEventListener("change", syncListening);
      stopListening();
    };
  }, [items, targetId]);

  const jumpToSection = (id: string) => {
    const target = document.getElementById(targetId);
    const section = document.getElementById(id);
    if (!target || !section) return;

    const scroller = getReaderScroller(target);
    setActiveId(id);

    if (isWindowScroller(scroller)) {
      const top = window.scrollY + section.getBoundingClientRect().top - 82;
      window.scrollTo({ top, behavior: "smooth" });
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const top = scroller.scrollTop + section.getBoundingClientRect().top - scrollerRect.top - 82;
    scroller.scrollTo({ top, behavior: "smooth" });
  };

  if (items.length < 3) return null;

  return (
    <nav className="readerToc" aria-label={locale === "zh-Hans" ? "文章目录" : "Article contents"}>
      <div className="readerTocRail" aria-hidden="true">
        {items.map((item) => {
          const active = item.id === activeId;
          const width = active
            ? item.depth === 1 ? 26 : 15
            : item.depth === 1 ? 18 : 9;
          return (
            <button
              className={`readerTocRailTick readerTocRailTick--depth${item.depth} ${active ? "isActive" : ""}`}
              key={item.id}
              onClick={() => jumpToSection(item.id)}
              style={{ width }}
              tabIndex={-1}
              title={item.title}
              type="button"
            />
          );
        })}
      </div>

      <div className="readerTocPanel">
        <header>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M4 6h10M4 12h16M4 18h7" />
          </svg>
          <span>{locale === "zh-Hans" ? "目录" : "Contents"}</span>
          <strong>{items.length}</strong>
        </header>
        <div>
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                className={`readerTocRow readerTocRow--depth${item.depth} ${active ? "isActive" : ""}`}
                key={item.id}
                onClick={() => jumpToSection(item.id)}
                type="button"
              >
                <i aria-hidden="true" />
                <span>{item.number}</span>
                <strong>{item.title}</strong>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
