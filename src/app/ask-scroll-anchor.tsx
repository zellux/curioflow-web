"use client";

import { useEffect, useRef } from "react";

export function AskScrollAnchor({ messageId }: { messageId: string | null }) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const scroller = anchor?.closest<HTMLElement>(".scrollArea");
    if (!scroller || !messageId) return;

    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messageId]);

  return <div aria-hidden="true" className="askScrollAnchor" ref={anchorRef} />;
}
