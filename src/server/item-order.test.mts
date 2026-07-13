import assert from "node:assert/strict";
import test from "node:test";
import { compareItemsByRecentActivity, itemActivityTime, type ItemActivity } from "./item-order.ts";

function item(id: string, createdAt: string, lastReadAt: string | null): ItemActivity {
  return {
    id,
    createdAt: new Date(createdAt),
    lastReadAt: lastReadAt ? new Date(lastReadAt) : null
  };
}

test("activity time is the later of creation and latest read", () => {
  const importedAfterRead = item("imported", "2026-07-12T12:00:00Z", "2026-07-11T12:00:00Z");
  const readAfterImport = item("read", "2026-07-10T12:00:00Z", "2026-07-13T12:00:00Z");

  assert.equal(itemActivityTime(importedAfterRead), new Date("2026-07-12T12:00:00Z").getTime());
  assert.equal(itemActivityTime(readAfterImport), new Date("2026-07-13T12:00:00Z").getTime());
});

test("recent imports and recent reads share one descending order", () => {
  const items = [
    item("older-read", "2026-07-01T12:00:00Z", "2026-07-11T12:00:00Z"),
    item("recent-import", "2026-07-12T12:00:00Z", null),
    item("recent-read", "2026-07-02T12:00:00Z", "2026-07-13T12:00:00Z")
  ];

  assert.deepEqual(items.sort(compareItemsByRecentActivity).map(({ id }) => id), [
    "recent-read",
    "recent-import",
    "older-read"
  ]);
});
