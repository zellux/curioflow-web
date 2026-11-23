"use client";

import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { AddSourceButton } from "@/app/add-source-dialog";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";
import { SidebarScroll } from "@/app/sidebar-scroll";
import { SidebarNavigation } from "@/app/sidebar-navigation";
import { SettingsButton } from "@/app/settings-button";
import brandMark from "@/app/_assets/curioflow-logo-c13a-title.png";
import { workspaceLocation } from "@/app/workspace-location";
import { settingsOverlayHref } from "@/app/settings-overlay-state";

const APP_HOME = "/home" as Route;

function LibraryIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h11" />
    </svg>
  );
}

function SubscriptionsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
    </svg>
  );
}

function BriefIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 7h16M6 7v12h12V7M9 11h6M7 4h10l1 3H6z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.85" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.52a2 2 0 0 1-1 1.72l-.15.1a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.52a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    </svg>
  );
}

export function Sidebar({
  locale,
  llmEnabled,
  sources,
  userName,
  sourcesLoading = false,
  sourcesError = false
}: {
  locale: SystemLanguage;
  llmEnabled: boolean;
  sources: { id: string; type: string; _count: { items: number } }[];
  userName: string;
  sourcesLoading?: boolean;
  sourcesError?: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const params = workspaceLocation(pathname, search);
  const router = useRouter();
  const copy = getUiCopy(locale);
  const settingsHref = settingsOverlayHref(`${pathname}${search ? `?${search}` : ""}`);
  const activeSource = sources.find((source) => source.id === params.source);
  const pdfSource = sources.find((source) => source.type === "pdf");
  const pdfCount = pdfSource?._count.items ?? 0;
  const archived = params.filter === "archive" || params.view === "archive";
  const view = params.view === "debug" || (SHOW_DRAFT_READING_TOOLS && llmEnabled) ? params.view ?? "library" : "library";
  const subscriptionsActive = !params.item && !archived && (
    params.filter === "recent-posts" || params.filter === "newsletters" ||
    params.sourceKind === "feed" || params.sourceKind === "newsletter" ||
    activeSource?.type === "rss" || activeSource?.type === "newsletter"
  );
  const libraryActive = !params.item && !params.source && !params.q && !params.status && !archived && view === "library" && !subscriptionsActive;

  return (
    <SidebarNavigation ariaLabel={copy.nav.library}>
      <Link className="brand" href={APP_HOME} aria-label="Curioflow Self Hosted">
        <Image className="brandMark" src={brandMark} alt="" width={26} height={30} aria-hidden="true" priority />
        <strong className="brandName" aria-hidden="true">urio<span>flow</span></strong>
      </Link>

      <AddSourceButton label={copy.nav.addSource} />

      <nav className="navList">
        <Link className={libraryActive ? "active" : ""} href={APP_HOME}>
          <span className="navIcon"><LibraryIcon /></span>
          {copy.nav.library}
        </Link>
        {SHOW_DRAFT_READING_TOOLS && llmEnabled ? (
          <>
            <Link className={view === "brief" ? "active" : ""} href="/briefing">
              <span className="navIcon"><BriefIcon /></span>
              {copy.nav.briefing}
            </Link>
            <Link className={view === "ask" ? "active" : ""} href="/ask">
              <span className="navIcon"><AskIcon /></span>
              {copy.nav.ask}
            </Link>
          </>
        ) : null}
        <Link className={subscriptionsActive ? "active" : ""} href={appHref({ filter: "recent-posts" })}>
          <span className="navIcon"><SubscriptionsIcon /></span>
          {copy.nav.subscriptions}
        </Link>
        <Link className={archived ? "active" : ""} href="/archive">
          <span className="navIcon"><ArchiveIcon /></span>
          {copy.nav.archive}
        </Link>
      </nav>

      <SidebarScroll>
        {sourcesLoading ? <div className="sidebarSourcesLoading" role="status" aria-label={locale === "zh-Hans" ? "正在加载来源…" : "Loading sources…"}>
          <span className="skeletonLine" /><span className="skeletonLine" /><span className="skeletonLine" />
        </div> : sourcesError ? <div className="sidebarSourcesError" role="status">
          <span>{locale === "zh-Hans" ? "来源加载失败" : "Could not load sources"}</span>
          <button type="button" onClick={() => router.refresh()}>{locale === "zh-Hans" ? "重试" : "Try again"}</button>
        </div> : <section className="sideGroup">
          <Link className={`sideRow ${pdfSource && params.source === pdfSource.id ? "active" : ""}`} href={pdfSource ? appHref({ source: pdfSource.id }) : appHref({ source: "manual-pdf-source" })}>
            <span>{copy.sidebar.pdfUploads}</span>
            {pdfCount > 0 ? <strong>{pdfCount}</strong> : null}
          </Link>
        </section>}
      </SidebarScroll>

      <div className="sidebarFooter">
        <div className="workspaceCard">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <strong>{userName}</strong>
        </div>
        <Link className="sidebarDebugButton" href="/debug" aria-label="Debug" title="Debug" aria-current={view === "debug" ? "page" : undefined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m8 3 2 3m6-3-2 3M4 9h3m10 0h3M3 14h4m10 0h4M4 19l3-2m10 0 3 2" />
            <rect x="7" y="6" width="10" height="15" rx="5" />
            <path d="M7 11h10m-5 0v10" />
          </svg>
        </Link>
        <SettingsButton href={settingsHref} label={copy.nav.settings}>
          <SettingsIcon />
        </SettingsButton>
      </div>
    </SidebarNavigation>
  );
}
