"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavigationState } from "@/app/navigation-state";
import { useVisiblePolling } from "@/app/use-visible-polling";
import { hasCompletedWork } from "@/app/background-refresh";
import { workspaceLocation } from "@/app/workspace-location";
import { JobStatusStrip } from "@/app/job-status-strip";
import type { SystemLanguage } from "@/app/i18n";
import type { WorkspaceBackgroundState } from "@/server/workspace-background";

export function JobStatusRefresh({ initialState, locale }: {
  initialState: WorkspaceBackgroundState | null;
  locale: SystemLanguage;
}) {
  const router = useRouter();
  const { pending } = useNavigationState();
  const params = workspaceLocation(usePathname(), useSearchParams().toString());
  const isReader = Boolean(params.item);
  const [state, setState] = useState(initialState);
  const latestState = useRef(initialState);
  useEffect(() => {
    latestState.current = initialState;
    setState(initialState);
  }, [initialState]);

  const poll = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/workspace/status", { signal, cache: "no-store" });
    if (response.status === 401) {
      if (!signal.aborted) router.refresh();
      return;
    }
    if (!response.ok) return;
    const next = await response.json() as WorkspaceBackgroundState;
    if (signal.aborted) return;
    const previous = latestState.current;
    latestState.current = next;
    setState(next);
    // Progress updates only replace the status strip. Reader polling observes
    // its own article, so unrelated work cannot disrupt an open article.
    if (previous && !isReader && hasCompletedWork(previous, next)) router.refresh();
  }, [router, isReader]);
  useVisiblePolling(poll, !state || state.jobCounts.active > 0 ? 4000 : 15000, !pending);

  return state ? <JobStatusStrip jobCounts={state.jobCounts} jobs={state.jobs} locale={locale}
    sourceRollups={state.sourceJobRollups} sources={state.sources} /> : null;
}
