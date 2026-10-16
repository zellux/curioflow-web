import assert from "node:assert/strict";
import test from "node:test";
import { workspaceContentKey, workspaceLocation } from "../app/workspace-location.ts";
import { hasCompletedWork } from "../app/background-refresh.ts";
import { readerRevision } from "./reader-revision.ts";

test("shared navigation follows canonical and legacy URLs, including reader context", () => {
  assert.deepEqual(workspaceLocation("/source/feed/recent", "page=2"), { filter: "recent-posts", page: "2" });
  assert.deepEqual(workspaceLocation("/source/feed/feed%20one", ""), { source: "feed one", sourceKind: "feed" });
  assert.deepEqual(workspaceLocation("/source/newsletter/newsletter-one", ""), { source: "newsletter-one", sourceKind: "newsletter" });
  assert.deepEqual(workspaceLocation("/source/manual-pdf-source", ""), { source: "manual-pdf-source" });
  assert.deepEqual(workspaceLocation("/item/article-one", "filter=archive&source=feed-one"), { item: "article-one", filter: "archive", source: "feed-one" });
  assert.deepEqual(workspaceLocation("/home", "view=ask&thread=thread-one"), { view: "ask", thread: "thread-one" });
  assert.deepEqual(workspaceLocation("/briefing", ""), { view: "brief" });
  assert.deepEqual(workspaceLocation("/archive", ""), { filter: "archive" });
  assert.deepEqual(workspaceLocation("/newsletters", ""), { filter: "newsletters" });
  assert.deepEqual(workspaceLocation("/settings", ""), { settings: "1" });
  assert.deepEqual(workspaceLocation("/home", "settings=1&q=reading"), { settings: "1", q: "reading" });
  assert.doesNotThrow(() => workspaceLocation("/source/%broken", ""));
});

test("progress and newly queued work do not refresh content", () => {
  const before = { activeJobIds: ["job-one"], completedWorkVersion: "previous-job:1" };
  assert.equal(hasCompletedWork(before, { ...before }), false);
  assert.equal(hasCompletedWork(before, { ...before, activeJobIds: ["job-one", "job-two"] }), false);
});

test("content loading resets for feed, pagination and search navigation while preserving dialog and refresh state", () => {
  const feed = { source: "feed-one", sourceKind: "feed", page: "1" };
  const key = workspaceContentKey(feed);
  assert.notEqual(workspaceContentKey({ ...feed, source: "feed-two" }), key);
  assert.notEqual(workspaceContentKey({ ...feed, page: "2" }), key);
  assert.notEqual(workspaceContentKey({ ...feed, q: "reading" }), key);
  assert.notEqual(workspaceContentKey({ ...feed, filter: "archive" }), key);
  assert.notEqual(workspaceContentKey({ ...feed, item: "article-one" }), key);
  assert.equal(workspaceContentKey({ ...feed }), key);
  assert.equal(workspaceContentKey({ ...feed, settings: "1", settingsTab: "style", saved: "llm", summary: "regenerated" }), key);
});

test("completion, cancellation and jobs entirely between polls refresh content", () => {
  const before = { activeJobIds: ["job-one", "job-two"], completedWorkVersion: null };
  assert.equal(hasCompletedWork(before, { ...before, activeJobIds: ["job-two"] }), true);
  assert.equal(hasCompletedWork({ activeJobIds: [], completedWorkVersion: "old:1" }, {
    activeJobIds: [], completedWorkVersion: "new:2"
  }), true);
  // The version must observe all jobs, including jobs outside the visible strip.
  const manyJobs = { activeJobIds: Array.from({ length: 12 }, (_, index) => `job-${index}`), completedWorkVersion: null };
  assert.equal(hasCompletedWork(manyJobs, { ...manyJobs, activeJobIds: manyJobs.activeJobIds.slice(0, 11) }), true);
});

test("reader refreshes for content and summary changes, never for reading-position writes", () => {
  const item = { status: "pending", title: "Article", document: null, readingProgress: 0, readingPositionJson: "{}" };
  const afterReading = { ...item, readingProgress: 0.5, readingPositionJson: '{"scrollY":800}' };
  assert.equal(readerRevision(item), readerRevision(afterReading));
  const document = { id: "document-one", contentHash: "text-one", metadataJson: '{"summaryStatus":"pending"}' };
  const parsed = { ...item, status: "ready", document };
  assert.notEqual(readerRevision(item), readerRevision(parsed));
  assert.notEqual(readerRevision(parsed), readerRevision({ ...parsed, document: { ...document, metadataJson: '{"summaryStatus":"succeeded"}' } }));
  assert.notEqual(readerRevision(parsed), readerRevision({ ...parsed, document: { ...document, contentHash: "text-two" } }));
});
