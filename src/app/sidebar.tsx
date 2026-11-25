"use client";

import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { AddSourceButton } from "@/app/add-source-dialog";
import { FeedSidebarSection } from "@/app/feed-sidebar-section";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";
import { SidebarScroll } from "@/app/sidebar-scroll";
import { SidebarNavigation } from "@/app/sidebar-navigation";
import { SettingsButton } from "@/app/settings-button";
import brandMark from "@/app/_assets/curioflow-logo-c13a-title.png";
import { workspaceLocation } from "@/app/workspace-location";
import { settingsOverlayHref } from "@/app/settings-overlay-state";

const APP_HOME = "/home" as Route;

type SidebarSource = {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
  pendingCount: number;
  streamCount: number;
  _count: { items: number };
};

function subscriptionRow({ id, name, category, status, pendingCount, _count }: SidebarSource) {
  return { id, name, category, status, itemCount: pendingCount, totalItemCount: _count.items };
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

function PdfIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6v18h12V7l-4-4v4h4M9 12h6m-6 4h6" />
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
  sources: SidebarSource[];
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
  const rssSources = sources.filter((source) => source.type === "rss");
  const newsletterSources = sources.filter((source) => source.type === "newsletter");
  const pdfSource = sources.find((source) => source.type === "pdf");
  const pdfSourceId = pdfSource?.id ?? "manual-pdf-source";
  const pdfCount = pdfSource?._count.items ?? 0;
  const pdfActive = params.source === pdfSourceId;
  const archived = params.filter === "archive" || params.view === "archive";
  const view = params.view === "debug" || (SHOW_DRAFT_READING_TOOLS && llmEnabled) ? params.view ?? "library" : "library";
  const feedsActive = !params.item && !params.source && params.filter === "recent-posts";
  const newslettersActive = !params.item && !params.source && params.filter === "newsletters";
  const libraryActive = !params.item && !params.source && !params.q && !params.status && !archived && view === "library" && !feedsActive && !newslettersActive;
  const diagnosticsLabel = pickLocale(locale, {
    en: "Diagnostics",
    "zh-Hans": "诊断",
    "zh-Hant": "診斷",
    ja: "診断",
    ko: "진단"
  });

  return (
    <SidebarNavigation ariaLabel={copy.nav.library}>
      <Link className="brand" href={APP_HOME} aria-label="Curioflow">
        <Image className="brandMark" src={brandMark} alt="" width={26} height={30} aria-hidden="true" priority />
        <strong className="brandName" aria-hidden="true">urio<span>flow</span></strong>
      </Link>

      <AddSourceButton label={copy.nav.addSource} />

      <SidebarScroll>
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
          <Link className={archived ? "active" : ""} href="/archive">
            <span className="navIcon"><ArchiveIcon /></span>
            {copy.nav.archive}
          </Link>
          {sourcesLoading ? <div className="sidebarSourcesLoading" role="status" aria-label={pickLocale(locale, { en: "Loading sources…", "zh-Hans": "正在加载来源…", "zh-Hant": "正在載入來源…", ja: "ソースを読み込み中…", ko: "소스 불러오는 중…" })}>
            <span className="navIcon"><PdfIcon /></span>
            <span className="skeletonLine" />
          </div> : sourcesError ? <div className="sidebarSourcesError" role="status">
            <span>{pickLocale(locale, { en: "Could not load sources", "zh-Hans": "来源加载失败", "zh-Hant": "來源載入失敗", ja: "ソースを読み込めませんでした", ko: "소스를 불러올 수 없습니다" })}</span>
            <button type="button" onClick={() => router.refresh()}>{pickLocale(locale, { en: "Try again", "zh-Hans": "重试", "zh-Hant": "重試", ja: "再試行", ko: "다시 시도" })}</button>
          </div> : (
            <Link className={pdfActive ? "active" : ""} href={appHref({ source: pdfSourceId })} aria-current={pdfActive ? "page" : undefined}>
              <span className="navIcon"><PdfIcon /></span>
              {copy.sidebar.pdfUploads}
              {pdfCount > 0 ? <span className="navCount">{pdfCount}</span> : null}
            </Link>
          )}
        </nav>
        {!sourcesLoading && !sourcesError ? (
          <nav aria-label={copy.nav.subscriptions}>
            <FeedSidebarSection
              activeSourceId={archived ? undefined : activeSource?.id}
              activeSourceType={archived ? undefined : activeSource?.type}
              feedsActive={feedsActive}
              newslettersActive={newslettersActive}
              locale={locale}
              streamCounts={{ rss: rssSources[0]?.streamCount ?? 0, newsletter: newsletterSources[0]?.streamCount ?? 0 }}
              rssSources={rssSources.map(subscriptionRow)}
              newsletterSources={newsletterSources.map(subscriptionRow)}
            />
          </nav>
        ) : null}
      </SidebarScroll>

      <div className="sidebarFooter">
        <div className="workspaceCard">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <strong>{userName}</strong>
        </div>
        <Link
          className="sidebarDebugButton"
          href="/debug"
          aria-label={diagnosticsLabel}
          title={diagnosticsLabel}
          aria-current={view === "debug" ? "page" : undefined}
        >
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
