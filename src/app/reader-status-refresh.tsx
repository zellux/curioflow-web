"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useNavigationState } from "@/app/navigation-state";
import { useVisiblePolling } from "@/app/use-visible-polling";

export function ReaderStatusRefresh({ itemId, active, revision }: { itemId: string; active: boolean; revision: string }) {
  const router = useRouter();
  const { pending } = useNavigationState();
  const latestRevision = useRef(revision);
  useEffect(() => { latestRevision.current = revision; }, [revision]);
  const poll = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/status`, { signal, cache: "no-store" });
    if (response.status === 401 || response.status === 404) {
      if (!signal.aborted) router.refresh();
      return;
    }
    if (!response.ok) return;
    const body = await response.json() as { revision: string };
    if (signal.aborted || body.revision === latestRevision.current) return;
    latestRevision.current = body.revision;
    router.refresh();
  }, [itemId, router]);
  // Keep a slower check after processing ends, including changes from another
  // device. Only a change to this article can refresh the reader.
  useVisiblePolling(poll, active ? 4000 : 15000, !pending);
  return null;
}
