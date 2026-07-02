import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_STATUS,
  itemListVisibilityMode,
  normalizeReadStatus,
  savedToLibraryFilterForVisibility
} from "./item-state.ts";

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
