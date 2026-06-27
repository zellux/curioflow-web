"use client";

import Link from "next/link";
import { useState } from "react";
import { UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";
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

function ChevronIcon({ size = 11, strokeWidth = 2.4 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function FeedSidebarSection({
  activeSourceId,
  recentPostsActive,
  sources,
  totalItemCount
}: {
  activeSourceId?: string;
  recentPostsActive: boolean;
  sources: SidebarFeedSource[];
  totalItemCount: number;
}) {
  const [feedsOpen, setFeedsOpen] = useState(true);
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
      <button
        aria-expanded={feedsOpen}
        className="sideGroupHeader sideGroupHeaderButton"
        onClick={() => setFeedsOpen((open) => !open)}
        type="button"
      >
        <span>
          <span className={`sideGroupChevron ${feedsOpen ? "isOpen" : ""}`}><ChevronIcon /></span>
          Feeds
        </span>
        <strong>{sources.length}</strong>
      </button>

      {feedsOpen ? (
        <div className="feedSideList">
          <div className={`feedSideRow ${recentPostsActive ? "active" : ""}`}>
            <Link className="feedSideLink feedRecentLink" href="/recent-posts">
              <span className="feedRecentLabel"><ClockIcon /> <span>Recent posts</span></span>
              <strong className="feedSideCount">{totalItemCount}</strong>
            </Link>
          </div>
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
          {sources.length === 0 ? <p className="sideEmpty">No feeds yet</p> : null}
        </div>
      ) : null}
    </section>
  );
}
