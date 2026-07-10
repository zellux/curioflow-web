import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_STATUS,
  itemShowsArchiveAction,
  itemShowsSaveAction,
  itemListVisibilityMode,
  normalizeReadStatus,
  readStatusForProgress,
  savedToLibraryFilterForVisibility
} from "./item-state.ts";

test("reading progress has one completion invariant", () => {
  assert.equal(readStatusForProgress(0), READ_STATUS.UNREAD);
  assert.equal(readStatusForProgress(0.5), READ_STATUS.READING);
  assert.equal(readStatusForProgress(0.98), READ_STATUS.DONE);
});

test("source streams show unsaved items by default", () => {
  const mode = itemListVisibilityMode({ activeSourceType: "rss" });

  assert.equal(mode, "source-stream");
  assert.equal(savedToLibraryFilterForVisibility(mode), false);
});

test("archive visibility does not filter by library membership", () => {
  const mode = itemListVisibilityMode({ activeSourceType: "rss", archived: true });

  assert.equal(mode, "archive");
  assert.equal(savedToLibraryFilterForVisibility(mode), null);
});

test("normalizes legacy read status to done", () => {
  assert.equal(normalizeReadStatus("read"), READ_STATUS.DONE);
  assert.equal(normalizeReadStatus("done"), READ_STATUS.DONE);
  assert.equal(normalizeReadStatus("reading"), READ_STATUS.READING);
  assert.equal(normalizeReadStatus("unread"), READ_STATUS.UNREAD);
  assert.equal(normalizeReadStatus("finished"), null);
});

test("shows save for unsaved stream items until archived", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: false,
    sourceId: "source-1",
    source: { type: "rss" }
  };

  assert.equal(itemShowsSaveAction(item, { source: "source-1" }), true);
  assert.equal(itemShowsArchiveAction(item, { source: "source-1" }), true);
  assert.equal(itemShowsSaveAction({ ...item, archivedAt: new Date() }, { source: "source-1" }), false);
});

test("hides duplicate save action for saved library items", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: true,
    sourceId: "manual-url-source",
    source: { type: "url" }
  };

  assert.equal(itemShowsSaveAction(item, {}), false);
  assert.equal(itemShowsArchiveAction(item, {}), true);
});

test("keeps archived items restorable", () => {
  const item = {
    archivedAt: new Date(),
    savedToLibrary: false,
    sourceId: "source-1",
    source: { type: "rss" }
  };

  assert.equal(itemShowsSaveAction(item, { filter: "archive" }), false);
  assert.equal(itemShowsArchiveAction(item, { filter: "archive" }), true);
});

test("recognizes a feed occurrence even when the item originated elsewhere", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: false,
    sourceId: "manual-source",
    source: { type: "url" },
    sourceEntries: [
      { sourceId: "manual-source", source: { type: "url" } },
      { sourceId: "feed-source", source: { type: "rss" } }
    ]
  };
  assert.equal(itemShowsSaveAction(item, { source: "feed-source" }), true);
  assert.equal(itemShowsArchiveAction(item, { source: "feed-source" }), true);
});
