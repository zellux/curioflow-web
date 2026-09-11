import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../src/server/db.ts";
import { getMobileSyncPayload } from "../src/server/mobile.ts";

before(async () => {
  await prisma.account.create({ data: { id: "service-account", name: "Service tests" } });
  await prisma.user.create({ data: { id: "service-user", accountId: "service-account", displayName: "Test" } });
  await prisma.library.create({ data: { id: "service-library", accountId: "service-account", name: "Test" } });
});
after(async () => { await prisma.$disconnect(); });

test("initial mobile sync delivers every item and catches changes during pagination", async () => {
  await prisma.item.createMany({ data: Array.from({ length: 300 }, (_, i) => ({
    id: `snapshot-${String(i).padStart(3, "0")}`, libraryId: "service-library", type: "article", title: `Article ${i}`
  })) });
  let page = await getMobileSyncPayload("http://localhost/api/mobile/v1/sync?scope=all&limit=150");
  const watermark = page.watermark;
  const delivered = new Set(page.items.map(item => item.id));
  assert.equal(page.hasMore, true);
  // Sorting by reading activity or applying an offset would skip rows here.
  await prisma.item.update({ where: { id: "snapshot-200" }, data: { lastReadAt: new Date() } });
  await prisma.item.create({ data: { id: "before-snapshot", libraryId: "service-library", type: "article", title: "Concurrent save" } });
  for (let count = 0; page.hasMore; count++) {
    assert.ok(count < 10, "snapshot pagination must terminate");
    assert.ok(page.nextPageCursor);
    page = await getMobileSyncPayload(`http://localhost/api/mobile/v1/sync?scope=all&limit=150&watermark=${watermark}&pageCursor=${encodeURIComponent(page.nextPageCursor)}`);
    assert.equal(page.watermark, watermark);
    for (const item of page.items) delivered.add(item.id);
  }
  assert.equal([...delivered].filter(id => id.startsWith("snapshot-")).length, 300);
  const delta = await getMobileSyncPayload(`http://localhost/api/mobile/v1/sync?scope=all&limit=150&cursor=${watermark}`);
  assert.ok(delta.items.some(item => item.id === "before-snapshot"));
  assert.ok(delta.items.some(item => item.id === "snapshot-200"));
  const defaultPage = await getMobileSyncPayload("http://localhost/api/mobile/v1/sync?scope=all");
  assert.equal(defaultPage.items.length, 100);
});
