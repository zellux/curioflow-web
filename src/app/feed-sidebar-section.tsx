"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { WarningTriangleIcon } from "@/app/item-icons";
import { appHref } from "@/app/routes";

type SidebarFeedSource = {
  id: string;
  name: string;
  category: string | null;
  status: string;
  itemCount: number;
};

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

const FEEDS_OPEN_STORAGE_KEY = "curioflow-sidebar-feeds-open";
const COLLAPSED_CATEGORIES_STORAGE_KEY = "curioflow-sidebar-collapsed-feed-categories";
let cachedFeedsOpen = true;
let hasCachedFeedsOpen = false;
let cachedCollapsedCategories: Record<string, boolean> = {};
let hasCachedCollapsedCategories = false;

function saveFeedsOpenPreference(open: boolean) {
  cachedFeedsOpen = open;
  hasCachedFeedsOpen = true;
  document.documentElement.dataset.sidebarFeedsOpen = open ? "1" : "0";

  try {
    window.localStorage.setItem(FEEDS_OPEN_STORAGE_KEY, open ? "1" : "0");
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
  locale,
  recentPostsActive,
  sources,
  totalItemCount
}: {
  activeSourceId?: string;
  locale: SystemLanguage;
  recentPostsActive: boolean;
  sources: SidebarFeedSource[];
  totalItemCount: number;
}) {
  const copy = getUiCopy(locale);
  const [feedsOpen, setFeedsOpen] = useState(() => cachedFeedsOpen);
  const [collapsedCategories, setCollapsedCategories] = useState(() => cachedCollapsedCategories);
  const rootSources = sources.filter((source) => !source.category);
  const activeSourceCategory = sources.find((source) => source.id === activeSourceId)?.category ?? null;
  const categoryNames = Array.from(
    new Set(sources.map((source) => source.category).filter((category): category is string => Boolean(category)))
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

  function toggleFeedsOpen() {
    setFeedsOpen((open) => {
      const nextOpen = !open;
      saveFeedsOpenPreference(nextOpen);
      return nextOpen;
    });
  }

  useEffect(() => {
    if (hasCachedFeedsOpen) return;

    try {
      const stored = window.localStorage.getItem(FEEDS_OPEN_STORAGE_KEY);
      if (stored !== "0" && stored !== "1") {
        const shouldOpenByDefault = !window.matchMedia("(max-width: 640px)").matches;
        cachedFeedsOpen = shouldOpenByDefault;
        hasCachedFeedsOpen = true;
        document.documentElement.dataset.sidebarFeedsOpen = shouldOpenByDefault ? "1" : "0";
        setFeedsOpen(shouldOpenByDefault);
        return;
      }
      const open = stored === "1";
      cachedFeedsOpen = open;
      hasCachedFeedsOpen = true;
      document.documentElement.dataset.sidebarFeedsOpen = open ? "1" : "0";
      setFeedsOpen(open);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    setCollapsedCategories(readCollapsedCategoriesPreference());
  }, []);

  function renderSourceRow(source: SidebarFeedSource, className = "") {
    const importing = source.status === "importing";
    const refreshFailed = source.status === "error";

    return (
      <div className={`feedSideRow hasFeedActions ${className} ${importing ? "isImporting" : ""} ${refreshFailed ? "hasRefreshError" : ""} ${activeSourceId === source.id ? "active" : ""}`} key={source.id}>
        <Link className="feedSideLink" href={appHref({ source: source.id, sourceKind: "feed" })}>
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
          sourceId={source.id}
          sourceName={source.name}
        >
          <span aria-hidden="true">×</span>
        </UnsubscribeSourceButton>
      </div>
    );
  }

  return (
    <section className="sideGroup">
      <div className="feedSectionHeader">
        <button
          aria-expanded={feedsOpen}
          className="feedCollapseButton"
          onClick={toggleFeedsOpen}
          title={feedsOpen ? (locale === "zh-Hans" ? "折叠订阅源" : "Collapse feeds") : (locale === "zh-Hans" ? "展开订阅源" : "Expand feeds")}
          type="button"
        >
          <span className={`sideGroupChevron ${feedsOpen ? "isOpen" : ""}`}><ChevronIcon /></span>
        </button>
        <Link className={`feedHeaderLink ${recentPostsActive ? "active" : ""}`} href={appHref({ filter: "recent-posts" })}>
          <span>{copy.sidebar.feeds}</span>
          <strong>{totalItemCount}</strong>
        </Link>
      </div>

      {feedsOpen ? <div className="feedSidebarBody">
        <div className="feedSideList">
          {rootSources.map((source) => renderSourceRow(source))}
          {categoryNames.map((category) => {
            const categorySources = sources.filter((source) => source.category === category);
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
                {isOpen ? categorySources.map((source) => renderSourceRow(source, "feedSideRowNested")) : null}
              </div>
            );
          })}
          {sources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noFeeds}</p> : null}
        </div>
      </div> : null}
    </section>
  );
}
