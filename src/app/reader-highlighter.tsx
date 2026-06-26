"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type HighlightTarget = {
  quote: string;
  top: number;
  left: number;
};

type ReaderHighlighterProps = {
  itemId: string;
  targetId: string;
};

function selectionInside(target: HTMLElement, selection: Selection) {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  if (!element || !target.contains(element)) return null;

  const quote = selection.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    quote,
    top: Math.max(12, rect.top - 44),
    left: Math.min(window.innerWidth - 138, Math.max(12, rect.left + rect.width / 2 - 58))
  };
}

export function ReaderHighlighter({ itemId, targetId }: ReaderHighlighterProps) {
  const router = useRouter();
  const [target, setTarget] = useState<HighlightTarget | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const inspectSelection = useCallback(() => {
    const root = document.getElementById(targetId);
    const selection = window.getSelection();
    if (!root || !selection) {
      setTarget(null);
      return;
    }

    setTarget(selectionInside(root, selection));
  }, [targetId]);

  useEffect(() => {
    document.addEventListener("mouseup", inspectSelection);
    document.addEventListener("keyup", inspectSelection);
    document.addEventListener("selectionchange", inspectSelection);
    window.addEventListener("scroll", inspectSelection, { passive: true });

    return () => {
      document.removeEventListener("mouseup", inspectSelection);
      document.removeEventListener("keyup", inspectSelection);
      document.removeEventListener("selectionchange", inspectSelection);
      window.removeEventListener("scroll", inspectSelection);
    };
  }, [inspectSelection]);

  const saveHighlight = async () => {
    if (!target || isSaving) return;
    setIsSaving(true);

    await fetch(`/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote: target.quote,
        location: {
          targetId,
          capture: "selection",
          savedAt: new Date().toISOString()
        }
      })
    });

    window.getSelection()?.removeAllRanges();
    setTarget(null);
    setIsSaving(false);
    router.refresh();
  };

  if (!target) return null;

  return (
    <button
      className="selectionHighlightButton"
      disabled={isSaving}
      onMouseDown={(event) => event.preventDefault()}
      onClick={saveHighlight}
      style={{ left: target.left, top: target.top }}
      type="button"
    >
      {isSaving ? "Saving..." : "Highlight"}
    </button>
  );
}
