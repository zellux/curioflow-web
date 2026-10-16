"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { workspaceLocation } from "@/app/workspace-location";

export function WorkspaceLabel({ locale, sources, llmEnabled }: {
  locale: SystemLanguage;
  sources: { id: string; name: string }[];
  llmEnabled: boolean;
}) {
  const params = workspaceLocation(usePathname(), useSearchParams().toString());
  const copy = getUiCopy(locale);
  if (params.view === "debug") return "Debug";
  if (llmEnabled && (params.view === "brief" || params.view === "digest")) return copy.nav.briefing;
  if (llmEnabled && params.view === "ask") return copy.nav.ask;
  if (params.q) return copy.common.searchResults;
  if (params.filter === "archive" || params.view === "archive") return copy.nav.archive;
  if (params.filter === "recent-posts") return copy.sidebar.recentPosts;
  if (params.filter === "newsletters") return copy.sidebar.newsletters;
  return sources.find(source => source.id === params.source)?.name ?? copy.nav.library;
}
