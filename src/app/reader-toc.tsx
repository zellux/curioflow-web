"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function sectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function ReaderToc({ items, locale = "en", targetId }: ReaderTocProps) {
  const [activeId, setActiveId] = useState(() => items[0]?.id ?? "");
  const frameRef = useRef<number | null>(null);

  const updateActiveSection = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const target = document.getElementById(targetId);
      if (!target || items.length === 0) return;

      const scroller = getReaderScroller(target);
      const scrollerTop = isWindowScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
      let currentId = items[0].id;

      for (const item of items) {
        const section = document.getElementById(item.id);
        if (!section) continue;

        const top = section.getBoundingClientRect().top - scrollerTop;
        if (top <= 140) {
          currentId = item.id;
        } else {
          break;
        }
      }

      setActiveId((current) => (current === currentId ? current : currentId));
    });
  }, [targetId, items]);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const scroller = target ? getReaderScroller(target) : window;

    updateActiveSection();
    scroller.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      scroller.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [targetId, updateActiveSection]);

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
          return (
            <button
              className={active ? "isActive" : ""}
              key={item.id}
              onClick={() => jumpToSection(item.id)}
              style={{ width: active ? 24 : 13 }}
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
          {items.map((item, index) => {
            const active = item.id === activeId;
            return (
              <button
                className={`readerTocRow ${active ? "isActive" : ""}`}
                key={item.id}
                onClick={() => jumpToSection(item.id)}
                style={{ paddingLeft: item.level > 2 ? 18 : undefined }}
                type="button"
              >
                <i aria-hidden="true" />
                <span>{sectionNumber(index)}</span>
                <strong>{item.title}</strong>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
