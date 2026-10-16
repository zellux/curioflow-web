"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { AddSourceButton } from "@/app/add-source-dialog";
import { FeedSidebarSection } from "@/app/feed-sidebar-section";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";
import { SidebarScroll } from "@/app/sidebar-scroll";
import { SidebarNavigation } from "@/app/sidebar-navigation";
import { SettingsButton } from "@/app/settings-button";
import brandMark from "@/app/_assets/curioflow-logo-c13a-title.png";
import { workspaceLocation } from "@/app/workspace-location";
import { settingsOverlayHref } from "@/app/settings-overlay-state";

const APP_HOME = "/home" as Route;

type LibraryFilter = {
  query?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  status?: string | null;
  archived?: boolean | null;
  recentPosts?: boolean | null;
};

export type SidebarSource = {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
  pendingCount: number;
  streamCount: number;
  _count: { items: number };
};

function appRoute(params: Record<string, string | undefined>) {
  return appHref(params) as Route;
}

function isUnfiltered(filter: LibraryFilter) {
  return !filter.query && !filter.sourceId && !filter.sourceType && !filter.status && !filter.archived && !filter.recentPosts;
}

function LibraryIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h11" />
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
  sources,
  llmEnabled,
  userName,
  sourcesLoading = false,
  sourcesError = false
}: {
  locale: SystemLanguage;
  sources: SidebarSource[];
  llmEnabled: boolean;
  userName: string;
  sourcesLoading?: boolean;
  sourcesError?: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const params = workspaceLocation(pathname, search);
  const router = useRouter();
  const copy = getUiCopy(locale);
  const view = params.view === "debug" || llmEnabled ? params.view ?? "library" : "library";
  const activeItemId = params.item;
  const filter: LibraryFilter = {
    query: params.q,
    sourceId: params.source,
    sourceType: params.filter === "newsletters" ? "newsletter" : params.filter === "recent-posts" ? "rss" : undefined,
    status: params.status,
    archived: params.filter === "archive" || params.view === "archive",
    recentPosts: params.filter === "recent-posts"
  };
  const settingsHref = settingsOverlayHref(`${pathname}${search ? `?${search}` : ""}`);
  const rssSources = sources.filter((source) => source.type === "rss");
  const newsletterSources = sources.filter((source) => source.type === "newsletter");
  const pdfSource = sources.find((source) => source.type === "pdf");
  const pdfCount = pdfSource?._count.items ?? 0;
  const activeClass = !activeItemId && view === "library" && isUnfiltered(filter) ? "active" : "";
  const recentPostsActiveClass = filter.recentPosts ? "active" : "";

  return (
    <SidebarNavigation ariaLabel={copy.nav.library}>
      <Link className="brand" href={APP_HOME} aria-label="Curioflow Self Hosted">
        <Image className="brandMark" src={brandMark} alt="" width={26} height={30} aria-hidden="true" priority />
        <strong className="brandName" aria-hidden="true">urio<span>flow</span></strong>
      </Link>

      <AddSourceButton label={copy.nav.addSource} />

      <nav className="navList">
        <Link className={activeClass} href={APP_HOME}>
          <span className="navIcon"><LibraryIcon /></span>
          {copy.nav.library}
        </Link>
        {llmEnabled ? (
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
        <Link className={filter.archived ? "active" : ""} href="/archive">
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
        </div> : <>
        <FeedSidebarSection
          activeSourceId={filter.sourceId ?? undefined}
          activeSourceType={sources.find((source) => source.id === filter.sourceId)?.type}
          streamCounts={{ rss: rssSources[0]?.streamCount ?? 0, newsletter: newsletterSources[0]?.streamCount ?? 0 }}
          feedsActive={Boolean(recentPostsActiveClass)}
          locale={locale}
          newsletterSources={newsletterSources.map((source) => ({ id: source.id, name: source.name, category: source.category, status: source.status, itemCount: source.pendingCount, totalItemCount: source._count.items }))}
          newslettersActive={filter.sourceType === "newsletter" && !filter.sourceId}
          rssSources={rssSources.map((source) => ({ id: source.id, name: source.name, category: source.category, status: source.status, itemCount: source.pendingCount, totalItemCount: source._count.items }))}
        />

        <section className="sideGroup">
          <Link className={`sideRow ${pdfSource && filter.sourceId === pdfSource.id ? "active" : ""}`} href={pdfSource ? appRoute({ source: pdfSource.id }) : appRoute({ source: "manual-pdf-source" })}>
            <span>{copy.sidebar.pdfUploads}</span>
            {pdfCount > 0 ? <strong>{pdfCount}</strong> : null}
          </Link>
        </section>
        </>}
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
