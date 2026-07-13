import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { AddSourceButton } from "@/app/add-source-dialog";
import { FeedSidebarSection } from "@/app/feed-sidebar-section";
import type { SystemLanguage, UiCopy } from "@/app/i18n";
import { appHref } from "@/app/routes";
import brandMark from "@/app/_assets/curioflow-logo-c13a-title.png";
import type { getLibrarySources } from "@/server/sources";

const APP_HOME = "/home" as Route;

type LibraryFilter = {
  query?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  status?: string | null;
  archived?: boolean | null;
  recentPosts?: boolean | null;
};

type AppView = "library" | "brief" | "ask" | "settings";

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
  copy,
  locale,
  sources,
  activeItemId,
  filter,
  llmEnabled,
  settingsHref,
  view,
  userName
}: {
  copy: UiCopy;
  locale: SystemLanguage;
  sources: Awaited<ReturnType<typeof getLibrarySources>>;
  activeItemId?: string;
  filter: LibraryFilter;
  llmEnabled: boolean;
  settingsHref: Route;
  view: AppView;
  userName: string;
}) {
  const rssSources = sources.filter((source) => source.type === "rss");
  const podcastSources = sources.filter((source) => source.type === "podcast");
  const rssItemCount = rssSources.reduce((total, source) => total + source._count.items, 0);
  const pdfSource = sources.find((source) => source.type === "pdf");
  const pdfCount = pdfSource?._count.items ?? 0;
  const activeClass = !activeItemId && view === "library" && isUnfiltered(filter) ? "active" : "";
  const recentPostsActiveClass = filter.recentPosts ? "active" : "";

  return (
    <aside className="sidebar" aria-label={copy.nav.library}>
      <Link className="brand" href={APP_HOME} aria-label="Curioflow Self Hosted">
        <Image className="brandMark" src={brandMark} alt="" width={26} height={30} aria-hidden="true" priority />
        <strong className="brandName" aria-hidden="true">urio<span>flow</span></strong>
        <span className="selfHostedBadge" aria-hidden="true">Self Hosted</span>
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

      <div className="sidebarScroll">
        <FeedSidebarSection
          activeSourceId={filter.sourceId ?? undefined}
          locale={locale}
          recentPostsActive={Boolean(recentPostsActiveClass)}
          sources={rssSources.map((source) => ({ id: source.id, name: source.name, category: source.category, status: source.status, itemCount: source._count.items }))}
          totalItemCount={rssItemCount}
        />

        <section className="sideGroup">
          <h2>{copy.sidebar.podcasts}</h2>
          {podcastSources.slice(0, 8).map((source) => (
            <div className={`feedSideRow ${filter.sourceId === source.id ? "active" : ""}`} key={source.id}>
              <Link className="feedSideLink" href={appRoute({ source: source.id, sourceKind: "podcast" })}>
                <span>{source.name}</span>
                <strong>{source._count.items}</strong>
              </Link>
            </div>
          ))}
          {podcastSources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noPodcasts}</p> : null}
        </section>

        <section className="sideGroup">
          <h2>{copy.sidebar.library}</h2>
          <Link className={`sideRow ${pdfSource && filter.sourceId === pdfSource.id ? "active" : ""}`} href={pdfSource ? appRoute({ source: pdfSource.id }) : appRoute({ source: "manual-pdf-source" })}>
            <span>{copy.sidebar.pdfUploads}</span>
            <strong>{pdfCount}</strong>
          </Link>
        </section>
      </div>

      <div className="sidebarFooter">
        <div className="workspaceCard">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <strong>{userName}</strong>
        </div>
        <Link className="sidebarSettingsButton" href={settingsHref} title={copy.nav.settings} aria-label={copy.nav.settings}>
          <SettingsIcon />
        </Link>
      </div>
    </aside>
  );
}
