"use client";

import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import { usePathname, useSearchParams } from "next/navigation";
import { highlightsCopy } from "@/app/highlights-copy";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { starredCopy } from "@/app/starred-copy";
import { workspaceLocation } from "@/app/workspace-location";
import { PDF_COLLECTION_SOURCE_ID } from "@/server/item-state";

export function WorkspaceLabel({ locale, sources, llmEnabled }: {
  locale: SystemLanguage;
  llmEnabled: boolean;
  sources: { id: string; name: string; type: string }[];
}) {
  const params = workspaceLocation(usePathname(), useSearchParams().toString());
  const copy = getUiCopy(locale);
  if (params.view === "debug") return "Debug";
  if (params.view === "highlights") return highlightsCopy(locale).label;
  if (SHOW_DRAFT_READING_TOOLS && llmEnabled && (params.view === "brief" || params.view === "digest")) return copy.nav.briefing;
  if (SHOW_DRAFT_READING_TOOLS && llmEnabled && params.view === "ask") return copy.nav.ask;
  if (params.q) return copy.common.searchResults;
  if (params.filter === "starred") return starredCopy(locale).label;
  if (params.filter === "archive" || params.view === "archive") return copy.nav.archive;
  if (params.filter === "recent-posts" || params.filter === "newsletters") return copy.nav.subscriptions;
  const source = sources.find(source => source.id === params.source);
  if (params.source === PDF_COLLECTION_SOURCE_ID || source?.type === "pdf") return copy.sidebar.pdf;
  return source?.name ?? copy.nav.library;
}
