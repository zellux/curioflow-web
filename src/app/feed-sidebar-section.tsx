"use client";

import Link from "next/link";
import { useState } from "react";
import { UnsubscribeSourceButton } from "@/app/confirm-dialog-buttons";

type SidebarFeedSource = {
  id: string;
  name: string;
  itemCount: number;
};

function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
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
          <Link className={`feedSideRow feedSideLink feedRecentLink ${recentPostsActive ? "active" : ""}`} href="/?filter=recent-posts">
            <span><ClockIcon /> Recent posts</span>
            <strong>{totalItemCount}</strong>
          </Link>
          {sources.slice(0, 8).map((source) => (
            <div className={`feedSideRow ${activeSourceId === source.id ? "active" : ""}`} key={source.id}>
              <Link className="feedSideLink" href={`/?source=${source.id}`}>
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
          ))}
          {sources.length === 0 ? <p className="sideEmpty">No feeds yet</p> : null}
        </div>
      ) : null}
    </section>
  );
}
