"use client";

import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import { usePathname, useSearchParams } from "next/navigation";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { workspaceLocation } from "@/app/workspace-location";

export function WorkspaceLabel({ locale, sources, llmEnabled }: {
  locale: SystemLanguage;
  llmEnabled: boolean;
  sources: { id: string; name: string }[];
}) {
  const params = workspaceLocation(usePathname(), useSearchParams().toString());
  const copy = getUiCopy(locale);
  if (params.view === "debug") return "Debug";
  if (SHOW_DRAFT_READING_TOOLS && llmEnabled && (params.view === "brief" || params.view === "digest")) return copy.nav.briefing;
  if (SHOW_DRAFT_READING_TOOLS && llmEnabled && params.view === "ask") return copy.nav.ask;
  if (params.q) return copy.common.searchResults;
  if (params.filter === "archive" || params.view === "archive") return copy.nav.archive;
  if (params.filter === "recent-posts" || params.filter === "newsletters") return copy.nav.subscriptions;
  return sources.find(source => source.id === params.source)?.name ?? copy.nav.library;
}
