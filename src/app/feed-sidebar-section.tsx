"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { WarningTriangleIcon } from "@/app/item-icons";
import { appHref } from "@/app/routes";

type SidebarSource = {
  id: string;
  name: string;
  category: string | null;
  status: string;
  itemCount: number;
};

type SourceSection = "feeds" | "newsletters" | "podcasts";
type SourceKind = "feed" | "newsletter" | "podcast";

const CATEGORY_ORDER = [
  "Technology",
  "Research",
  "Essays & Ideas",
  "Products",
  "Design",
  "Apps",
  "Dev",
  "Machine Learning",
  "Math + Algorithm",
  "Friends",
  "My Own Blogs",
  "Trends",
  "Others",
  "All"
];

const OPEN_SECTION_STORAGE_KEY = "curioflow-sidebar-open-source-section";
const LEGACY_FEEDS_OPEN_STORAGE_KEY = "curioflow-sidebar-feeds-open";
const COLLAPSED_CATEGORIES_STORAGE_KEY = "curioflow-sidebar-collapsed-feed-categories";
let cachedOpenSection: SourceSection | null = "feeds";
let hasCachedOpenSection = false;
let cachedCollapsedCategories: Record<string, boolean> = {};
let hasCachedCollapsedCategories = false;

function isSourceSection(value: string | null): value is SourceSection {
  return value === "feeds" || value === "newsletters" || value === "podcasts";
}

function saveOpenSectionPreference(section: SourceSection | null) {
  cachedOpenSection = section;
  hasCachedOpenSection = true;
  document.documentElement.dataset.sidebarSourceSection = section ?? "none";

  try {
    window.localStorage.setItem(OPEN_SECTION_STORAGE_KEY, section ?? "none");
  } catch {
    return;
  }
}

function readCollapsedCategoriesPreference() {
  if (hasCachedCollapsedCategories) return cachedCollapsedCategories;

  try {
    const stored = window.localStorage.getItem(COLLAPSED_CATEGORIES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as unknown : {};
    cachedCollapsedCategories = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>
      : {};
  } catch {
    cachedCollapsedCategories = {};
  }

  hasCachedCollapsedCategories = true;
  return cachedCollapsedCategories;
}

function saveCollapsedCategoriesPreference(categories: Record<string, boolean>) {
  cachedCollapsedCategories = categories;
  hasCachedCollapsedCategories = true;

  try {
    window.localStorage.setItem(COLLAPSED_CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
  } catch {
    return;
  }
}

function ChevronIcon({ size = 11, strokeWidth = 2.4 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function FeedSidebarSection({
  activeSourceId,
  activeSourceType,
  feedsActive,
  locale,
  newsletterSources,
  newslettersActive,
  podcastSources,
  podcastsActive,
  rssSources
}: {
  activeSourceId?: string;
  activeSourceType?: string;
  feedsActive: boolean;
  locale: SystemLanguage;
  newsletterSources: SidebarSource[];
  newslettersActive: boolean;
  podcastSources: SidebarSource[];
  podcastsActive: boolean;
  rssSources: SidebarSource[];
}) {
  const copy = getUiCopy(locale);
  const activeSection = activeSourceType === "newsletter"
    ? "newsletters"
    : activeSourceType === "podcast"
      ? "podcasts"
      : activeSourceType === "rss" || feedsActive
        ? "feeds"
        : newslettersActive
          ? "newsletters"
          : podcastsActive
            ? "podcasts"
            : null;
  const [openSection, setOpenSection] = useState<SourceSection | null>(() => activeSection ?? cachedOpenSection);
  const [collapsedCategories, setCollapsedCategories] = useState(() => cachedCollapsedCategories);
  const rssItemCount = rssSources.reduce((total, source) => total + source.itemCount, 0);
  const newsletterItemCount = newsletterSources.reduce((total, source) => total + source.itemCount, 0);
  const podcastItemCount = podcastSources.reduce((total, source) => total + source.itemCount, 0);
  const rootSources = rssSources.filter((source) => !source.category);
  const activeSourceCategory = rssSources.find((source) => source.id === activeSourceId)?.category ?? null;
  const categoryNames = Array.from(
    new Set(rssSources.map((source) => source.category).filter((category): category is string => Boolean(category)))
  ).sort((a, b) => {
    const aIndex = CATEGORY_ORDER.indexOf(a);
    const bIndex = CATEGORY_ORDER.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.localeCompare(b);
  });

  function toggleCategory(category: string) {
    setCollapsedCategories((current) => {
      const next = {
        ...current,
        [category]: !current[category]
      };
      saveCollapsedCategoriesPreference(next);
      return next;
    });
  }

  function toggleSection(section: SourceSection) {
    setOpenSection((current) => {
      const next = current === section ? null : section;
      saveOpenSectionPreference(next);
      return next;
    });
  }

  useEffect(() => {
    if (activeSection) {
      setOpenSection(activeSection);
      saveOpenSectionPreference(activeSection);
      return;
    }
    if (hasCachedOpenSection) return;

    try {
      const stored = window.localStorage.getItem(OPEN_SECTION_STORAGE_KEY);
      const legacyFeedsOpen = window.localStorage.getItem(LEGACY_FEEDS_OPEN_STORAGE_KEY);
      const section = isSourceSection(stored)
        ? stored
        : stored === "none" || legacyFeedsOpen === "0"
          ? null
          : "feeds";
      cachedOpenSection = section;
      hasCachedOpenSection = true;
      document.documentElement.dataset.sidebarSourceSection = section ?? "none";
      setOpenSection(section);
    } catch {
      return;
    }
  }, [activeSection]);

  useEffect(() => {
    setCollapsedCategories(readCollapsedCategoriesPreference());
  }, []);

  function renderSourceRow(source: SidebarSource, sourceKind: SourceKind, className = "") {
    const importing = source.status === "importing";
    const refreshFailed = source.status === "error";

    return (
      <div className={`feedSideRow hasFeedActions ${className} ${importing ? "isImporting" : ""} ${refreshFailed ? "hasRefreshError" : ""} ${activeSourceId === source.id ? "active" : ""}`} key={source.id}>
        <Link className="feedSideLink" href={appHref({ source: source.id, sourceKind })}>
          <span className="feedSideText">
            <span>{source.name}</span>
            {importing ? <small>{copy.common.importing}</small> : null}
            {refreshFailed ? <small>{copy.sidebar.feedError}</small> : null}
          </span>
          <span className="feedSideMeta">
            {refreshFailed ? (
              <span className="feedSideWarning" title={copy.sidebar.feedError}>
                <WarningTriangleIcon size={13} />
              </span>
            ) : null}
            <strong className="feedSideCount">{source.itemCount}</strong>
          </span>
        </Link>
        <UnsubscribeSourceButton
          className="feedUnsubscribeButton"
          itemCount={source.itemCount}
          locale={locale}
          returnFilter={sourceKind === "feed" ? "recent-posts" : `${sourceKind}s`}
          sourceId={source.id}
          sourceName={source.name}
        >
          <span aria-hidden="true">×</span>
        </UnsubscribeSourceButton>
      </div>
    );
  }

  function renderSectionHeader({
    active,
    count,
    href,
    label,
    section
  }: {
    active: boolean;
    count: number;
    href: ReturnType<typeof appHref>;
    label: string;
    section: SourceSection;
  }) {
    const isOpen = openSection === section;
    return (
      <div className="feedSectionHeader">
        <button
          aria-expanded={isOpen}
          className="feedCollapseButton"
          onClick={() => toggleSection(section)}
          title={locale === "zh-Hans"
            ? `${isOpen ? "折叠" : "展开"}${label}`
            : `${isOpen ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
          type="button"
        >
          <span className={`sideGroupChevron ${isOpen ? "isOpen" : ""}`}><ChevronIcon /></span>
        </button>
        <Link className={`feedHeaderLink ${active ? "active" : ""}`} href={href}>
          <span>{label}</span>
          <strong>{count}</strong>
        </Link>
      </div>
    );
  }

  return (
    <>
      <section className="sideGroup sourceSideGroup" data-source-section="feeds">
        {renderSectionHeader({
          active: feedsActive,
          count: rssItemCount,
          href: appHref({ filter: "recent-posts" }),
          label: copy.sidebar.feeds,
          section: "feeds"
        })}

        {openSection === "feeds" ? <div className="feedSidebarBody sourceSectionBody">
          <div className="feedSideList">
            {rootSources.map((source) => renderSourceRow(source, "feed"))}
            {categoryNames.map((category) => {
              const categorySources = rssSources.filter((source) => source.category === category);
              const categoryItemCount = categorySources.reduce((total, source) => total + source.itemCount, 0);
              const isOpen = activeSourceCategory === category || !collapsedCategories[category];

              return (
                <div className="feedCategory" key={category}>
                  <button
                    aria-expanded={isOpen}
                    className="feedCategoryHeader"
                    onClick={() => toggleCategory(category)}
                    type="button"
                  >
                    <span>
                      <span className={`sideGroupChevron ${isOpen ? "isOpen" : ""}`}><ChevronIcon size={10} strokeWidth={2.6} /></span>
                      {category}
                    </span>
                    <strong>{categoryItemCount}</strong>
                  </button>
                  {isOpen ? categorySources.map((source) => renderSourceRow(source, "feed", "feedSideRowNested")) : null}
                </div>
              );
            })}
            {rssSources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noFeeds}</p> : null}
          </div>
        </div> : null}
      </section>

      <section className="sideGroup sourceSideGroup" data-source-section="newsletters">
        {renderSectionHeader({
          active: newslettersActive,
          count: newsletterItemCount,
          href: appHref({ filter: "newsletters" }),
          label: copy.sidebar.newsletters,
          section: "newsletters"
        })}
        {openSection === "newsletters" ? <div className="feedSideList sourceSectionBody">
          {newsletterSources.map((source) => renderSourceRow(source, "newsletter"))}
          {newsletterSources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noNewsletters}</p> : null}
        </div> : null}
      </section>

      <section className="sideGroup sourceSideGroup" data-source-section="podcasts">
        {renderSectionHeader({
          active: podcastsActive,
          count: podcastItemCount,
          href: appHref({ filter: "podcasts" }),
          label: copy.sidebar.podcasts,
          section: "podcasts"
        })}
        {openSection === "podcasts" ? <div className="feedSideList sourceSectionBody">
          {podcastSources.map((source) => renderSourceRow(source, "podcast"))}
          {podcastSources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noPodcasts}</p> : null}
        </div> : null}
      </section>
    </>
  );
}
