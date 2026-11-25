import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("unread counts and mark-as-read cover one source or a whole stream", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-unread-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { getLibrarySourcesForLibrary, markSourceStreamReadForLibrary } = await import("./sources.ts");
  try {
    const account = await prisma.account.create({ data: { name: "Unread test" } });
    const library = await prisma.library.create({ data: { accountId: account.id, name: "Library" } });
    const feedA = await prisma.source.create({ data: { libraryId: library.id, name: "A", type: "rss", url: "https://a.example/feed" } });
    const feedB = await prisma.source.create({ data: { libraryId: library.id, name: "B", type: "rss", url: "https://b.example/feed" } });
    const letters = await prisma.source.create({ data: { libraryId: library.id, name: "Letters", type: "newsletter", url: "newsletter:letters" } });
    const item = async (sourceId: string, title: string, data: Record<string, unknown> = {}) => {
      const created = await prisma.item.create({ data: { libraryId: library.id, sourceId, type: "article", title, savedToLibrary: false, ...data } });
      await prisma.sourceEntry.create({ data: { libraryId: library.id, sourceId, itemId: created.id, entryKey: title } });
      return created;
    };
    const aUnread = await item(feedA.id, "A unread");
    const aPartial = await item(feedA.id, "A partial", { readingProgress: 0.4, readingPositionJson: "{\"scrollY\":900}" });
    await item(feedA.id, "A done", { readingProgress: 1, readStatus: "done" });
    await item(feedA.id, "A archived", { archivedAt: new Date() });
    await item(feedA.id, "A saved", { savedToLibrary: true });
    const bUnread = await item(feedB.id, "B unread");
    const letter = await item(letters.id, "Letter unread");

    const counts = async () => Object.fromEntries((await getLibrarySourcesForLibrary(library.id)).map((source) => [source.name, [source.unreadCount, source.streamUnreadCount]]));
    // Archived and finished items are not unread; saved ones still are.
    assert.deepEqual(await counts(), { A: [3, 4], B: [1, 4], Letters: [1, 1] });

    assert.equal(await markSourceStreamReadForLibrary(library.id, { sourceId: feedA.id }), 4);
    assert.deepEqual(await counts(), { A: [0, 1], B: [1, 1], Letters: [1, 1] });
    const partial = await prisma.item.findUniqueOrThrow({ where: { id: aPartial.id } });
    assert.equal(partial.readingProgress, 1);
    assert.equal(partial.readStatus, "done");
    assert.equal(partial.lastReadAt, null);
    assert.equal(partial.readingPositionJson, "{\"scrollY\":900}");
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: aUnread.id } })).readingProgress, 1);

    // A source from another library is ignored.
    const otherAccount = await prisma.account.create({ data: { name: "Other" } });
    const otherLibrary = await prisma.library.create({ data: { accountId: otherAccount.id, name: "Other" } });
    assert.equal(await markSourceStreamReadForLibrary(otherLibrary.id, { sourceId: feedB.id }), 0);

    assert.equal(await markSourceStreamReadForLibrary(library.id, { sourceType: "rss" }), 1);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: bUnread.id } })).readingProgress, 1);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: letter.id } })).readingProgress, 0);
    assert.deepEqual(await counts(), { A: [0, 0], B: [0, 0], Letters: [1, 1] });
  } finally {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
