"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";

type SidebarFeedSource = {
  id: string;
  name: string;
  category: string | null;
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
let cachedFeedsOpen = true;
let hasCachedFeedsOpen = false;

function saveFeedsOpenPreference(open: boolean) {
  cachedFeedsOpen = open;
  hasCachedFeedsOpen = true;

  try {
    window.localStorage.setItem(FEEDS_OPEN_STORAGE_KEY, open ? "1" : "0");
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
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const rootSources = sources.filter((source) => !source.category);
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
    setCollapsedCategories((current) => ({
      ...current,
      [category]: !current[category]
    }));
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
      if (stored !== "0" && stored !== "1") return;
      const open = stored === "1";
      cachedFeedsOpen = open;
      hasCachedFeedsOpen = true;
      setFeedsOpen(open);
    } catch {
      return;
    }
  }, []);

  function renderSourceRow(source: SidebarFeedSource, className = "") {
    return (
      <div className={`feedSideRow hasFeedActions ${className} ${activeSourceId === source.id ? "active" : ""}`} key={source.id}>
        <Link className="feedSideLink" href={appHref({ source: source.id, sourceKind: "feed" })}>
          <span>{source.name}</span>
          <strong className="feedSideCount">{source.itemCount}</strong>
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
        <Link className={`feedHeaderLink ${recentPostsActive ? "active" : ""}`} href="/recent-posts">
          <span>{copy.sidebar.feeds}</span>
          <strong>{totalItemCount}</strong>
        </Link>
      </div>

      {feedsOpen ? (
        <div className="feedSideList">
          {rootSources.map((source) => renderSourceRow(source))}
          {categoryNames.map((category) => {
            const categorySources = sources.filter((source) => source.category === category);
            const isOpen = !collapsedCategories[category];

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
                  <strong>{categorySources.length}</strong>
                </button>
                {isOpen ? categorySources.map((source) => renderSourceRow(source, "feedSideRowNested")) : null}
              </div>
            );
          })}
          {sources.length === 0 ? <p className="sideEmpty">{copy.sidebar.noFeeds}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
