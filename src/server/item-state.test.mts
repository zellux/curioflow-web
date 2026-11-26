import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_STATUS,
  archivedFilterForVisibility,
  isSourceStreamActionContext,
  itemShowsArchiveAction,
  itemShowsRemovalAction,
  itemShowsSaveAction,
  itemListVisibilityMode,
  itemStreamDisposition,
  normalizeReadStatus,
  readStatusForProgress,
  savedToLibraryFilterForVisibility
} from "./item-state.ts";

test("reading progress has one completion invariant", () => {
  assert.equal(readStatusForProgress(0), READ_STATUS.UNREAD);
  assert.equal(readStatusForProgress(0.5), READ_STATUS.READING);
  assert.equal(readStatusForProgress(0.98), READ_STATUS.DONE);
});

test("source streams keep saved and archived items visible", () => {
  const mode = itemListVisibilityMode({ activeSourceType: "rss" });

  assert.equal(mode, "source-stream");
  assert.equal(savedToLibraryFilterForVisibility(mode), null);
  assert.equal(archivedFilterForVisibility(mode), "all");
});

test("newsletter pages keep saved and archived items visible", () => {
  const mode = itemListVisibilityMode({ activeSourceType: "newsletter" });

  assert.equal(mode, "source-stream");
  assert.equal(savedToLibraryFilterForVisibility(mode), null);
  assert.equal(archivedFilterForVisibility(mode), "all");
});

test("library visibility shows only saved active items", () => {
  const mode = itemListVisibilityMode({});

  assert.equal(mode, "library");
  assert.equal(savedToLibraryFilterForVisibility(mode), true);
  assert.equal(archivedFilterForVisibility(mode), "active");
});

test("archive visibility does not filter by library membership", () => {
  const mode = itemListVisibilityMode({ activeSourceType: "rss", archived: true });

  assert.equal(mode, "archive");
  assert.equal(savedToLibraryFilterForVisibility(mode), null);
  assert.equal(archivedFilterForVisibility(mode), "archived");
});

test("computes stream disposition with archive taking precedence over library", () => {
  assert.equal(itemStreamDisposition({ archivedAt: null, savedToLibrary: false }), null);
  assert.equal(itemStreamDisposition({ archivedAt: null, savedToLibrary: true }), "library");
  assert.equal(itemStreamDisposition({ archivedAt: new Date(), savedToLibrary: false }), "archived");
  assert.equal(itemStreamDisposition({ archivedAt: new Date(), savedToLibrary: true }), "archived");
});

test("normalizes legacy read status to done", () => {
  assert.equal(normalizeReadStatus("read"), READ_STATUS.DONE);
  assert.equal(normalizeReadStatus("done"), READ_STATUS.DONE);
  assert.equal(normalizeReadStatus("reading"), READ_STATUS.READING);
  assert.equal(normalizeReadStatus("unread"), READ_STATUS.UNREAD);
  assert.equal(normalizeReadStatus("finished"), null);
});

test("shows save for unsaved stream items until saved or archived", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: false,
    sourceId: "source-1",
    source: { type: "rss" }
  };

  assert.equal(itemShowsSaveAction(item), true);
  assert.equal(itemShowsArchiveAction(item), false);
  assert.equal(itemShowsSaveAction({ ...item, savedToLibrary: true }), false);
  assert.equal(itemShowsArchiveAction({ ...item, savedToLibrary: true }), true);
  assert.equal(itemShowsSaveAction({ ...item, archivedAt: new Date() }), false);
});

test("newsletter stream items recognize stream context and expose save and archive actions", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: false,
    sourceId: "newsletter-source",
    source: { type: "newsletter" }
  };

  assert.equal(isSourceStreamActionContext(item, { filter: "newsletters" }), true);
  assert.equal(itemShowsSaveAction(item), true);
  assert.equal(itemShowsArchiveAction(item), false);
  assert.equal(itemShowsSaveAction(item), true);
  assert.equal(itemShowsArchiveAction(item), false);
  assert.equal(itemShowsSaveAction({ ...item, savedToLibrary: true }), false);
  assert.equal(itemShowsArchiveAction({ ...item, savedToLibrary: true }), true);
});

test("hides duplicate save action for saved library items", () => {
  const item = {
    archivedAt: null,
    savedToLibrary: true,
    sourceId: "manual-url-source",
    source: { type: "url" }
  };

  assert.equal(itemShowsSaveAction(item), false);
  assert.equal(itemShowsArchiveAction(item), true);
});

test("keeps archived items restorable", () => {
  const item = {
    archivedAt: new Date(),
    savedToLibrary: false,
    sourceId: "source-1",
    source: { type: "rss" }
  };

  assert.equal(itemShowsSaveAction(item), false);
  assert.equal(itemShowsArchiveAction(item), true);
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
  assert.equal(itemShowsSaveAction(item), true);
  assert.equal(itemShowsArchiveAction(item), false);
});

test("exposes removal action for library, archive, and unsubscribed items but not unsaved active feed items", () => {
  const activeFeed = {
    archivedAt: null,
    savedToLibrary: false,
    sourceEntries: [{ sourceId: "feed-1", source: { type: "rss", status: "active" } }]
  };
  const unsubscribedFeed = {
    archivedAt: null,
    savedToLibrary: false,
    sourceEntries: [{ sourceId: "feed-1", source: { type: "rss", status: "unsubscribed" } }]
  };

  assert.equal(itemShowsRemovalAction(activeFeed), false);
  assert.equal(itemShowsRemovalAction({ ...activeFeed, savedToLibrary: true }), true);
  assert.equal(itemShowsRemovalAction({ ...activeFeed, archivedAt: new Date() }), true);
  assert.equal(itemShowsRemovalAction(unsubscribedFeed), true);
  assert.equal(itemShowsRemovalAction({ archivedAt: null, savedToLibrary: false, sourceEntries: [] }), true);
});
