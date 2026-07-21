export type ItemActivity = {
  id: string;
  createdAt: Date;
  lastReadAt: Date | null;
};

export function itemActivityTime(item: Pick<ItemActivity, "createdAt" | "lastReadAt">) {
  return Math.max(item.createdAt.getTime(), item.lastReadAt?.getTime() ?? Number.NEGATIVE_INFINITY);
}

export function compareItemsByRecentActivity(left: ItemActivity, right: ItemActivity) {
  return itemActivityTime(right) - itemActivityTime(left)
    || right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}

export function compareItemsByCreationTime(left: Pick<ItemActivity, "id" | "createdAt">, right: Pick<ItemActivity, "id" | "createdAt">) {
  return right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}
