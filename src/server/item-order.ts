export type ItemActivity = {
  id: string;
  createdAt: Date;
  lastReadAt: Date | null;
};

export type FeedItemTime = {
  id: string;
  createdAt: Date;
  publishedAt: Date | null;
};

export function itemActivityTime(item: Pick<ItemActivity, "createdAt" | "lastReadAt">) {
  return Math.max(item.createdAt.getTime(), item.lastReadAt?.getTime() ?? Number.NEGATIVE_INFINITY);
}

export function compareItemsByRecentActivity(left: ItemActivity, right: ItemActivity) {
  return itemActivityTime(right) - itemActivityTime(left)
    || right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}

export function feedItemTime(item: Pick<FeedItemTime, "createdAt" | "publishedAt">) {
  return (item.publishedAt ?? item.createdAt).getTime();
}

export function compareItemsByFeedTime(left: FeedItemTime, right: FeedItemTime) {
  return feedItemTime(right) - feedItemTime(left)
    || right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}
