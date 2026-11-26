"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

type ReaderMoreMenuContextValue = {
  open: boolean;
  close: (returnFocus?: boolean) => void;
};

const ReaderMoreMenuContext = createContext<ReaderMoreMenuContextValue | null>(null);

export function useReaderMoreMenu() {
  return useContext(ReaderMoreMenuContext);
}

type ReaderMoreMenuProps = {
  children: ReactNode;
  className?: string;
  label: string;
};

function MoreHorizontalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

export function ReaderMoreMenu({ children, className, label }: ReaderMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [alignStart, setAlignStart] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setAlignStart(rect.right < 248 && window.innerWidth - rect.left >= 220);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        close();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")
      );
      if (!items.length) return;

      event.preventDefault();
      const currentIndex = items.findIndex((item) => item === document.activeElement);
      const nextIndex = event.key === "ArrowDown"
        ? (currentIndex + 1) % items.length
        : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
      items[nextIndex]?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const contextValue = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ReaderMoreMenuContext.Provider value={contextValue}>
      <div
        className={className ? `readerMore ${className}` : "readerMore"}
        data-open={open ? "true" : undefined}
        ref={rootRef}
      >
        <button
          aria-controls={menuId}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
          className="readerIconButton readerMoreTrigger"
          onClick={toggle}
          ref={triggerRef}
          title={label}
          type="button"
        >
          <MoreHorizontalIcon />
        </button>
        <div
          aria-hidden={!open}
          aria-label={label}
          className={`readerMoreMenu${open ? " isOpen" : ""}${alignStart ? " isAlignStart" : ""}`}
          id={menuId}
          inert={!open}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a[href], [data-close-menu]")) {
              close();
            }
          }}
          ref={menuRef}
          role="menu"
        >
          {children}
        </div>
      </div>
    </ReaderMoreMenuContext.Provider>
  );
}
