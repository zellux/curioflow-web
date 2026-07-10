import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_JOB_TYPES,
  fetchSourceIdFromPayload,
  fetchSourceProcessorForPayload,
  isFailedRssFetchSourceJob,
  isProcessableBackgroundJobType,
  jobRetryDelayMs,
  shouldRetryJob,
  processableBackgroundJobTypes
} from "./background-job-state.ts";

test("background job processable types are explicit", () => {
  assert.deepEqual(processableBackgroundJobTypes(), [
    BACKGROUND_JOB_TYPES.INGEST_URL,
    BACKGROUND_JOB_TYPES.PARSE_PDF,
    BACKGROUND_JOB_TYPES.REFETCH_ARTICLE,
    BACKGROUND_JOB_TYPES.FETCH_SOURCE,
    BACKGROUND_JOB_TYPES.GENERATE_SUMMARY
  ]);
  assert.equal(isProcessableBackgroundJobType("fetch_source"), true);
  assert.equal(isProcessableBackgroundJobType("ingest_url"), true);
  assert.equal(isProcessableBackgroundJobType("parse_pdf"), true);
  assert.equal(isProcessableBackgroundJobType("refetch_article"), true);
});

test("fetch source jobs route podcast payloads to the podcast processor", () => {
  assert.equal(fetchSourceProcessorForPayload(JSON.stringify({ feedTitle: "Show", episodes: [] })), "podcast");
});

test("fetch source jobs default to RSS processing", () => {
  assert.equal(fetchSourceProcessorForPayload(JSON.stringify({ entries: [] })), "rss");
  assert.equal(fetchSourceProcessorForPayload("not json"), "rss");
});

test("fetch source payload source ids are parsed defensively", () => {
  assert.equal(fetchSourceIdFromPayload(JSON.stringify({ sourceId: "source-1" })), "source-1");
  assert.equal(fetchSourceIdFromPayload(JSON.stringify({ sourceId: "" })), null);
  assert.equal(fetchSourceIdFromPayload("not json"), null);
});

test("failed RSS source jobs are identifiable separately from global failures", () => {
  const rssSourceIds = new Set(["rss-source"]);
  assert.equal(
    isFailedRssFetchSourceJob({
      payloadJson: JSON.stringify({ sourceId: "rss-source" }),
      status: "failed",
      type: BACKGROUND_JOB_TYPES.FETCH_SOURCE
    }, rssSourceIds),
    true
  );
  assert.equal(
    isFailedRssFetchSourceJob({
      payloadJson: JSON.stringify({ feedTitle: "Podcast", sourceId: "podcast-source" }),
      status: "failed",
      type: BACKGROUND_JOB_TYPES.FETCH_SOURCE
    }, rssSourceIds),
    false
  );
  assert.equal(
    isFailedRssFetchSourceJob({
      payloadJson: JSON.stringify({ sourceId: "rss-source" }),
      status: "queued",
      type: BACKGROUND_JOB_TYPES.FETCH_SOURCE
    }, rssSourceIds),
    false
  );
});

test("retry policy stops at max attempts and backs off", () => {
  assert.equal(shouldRetryJob(1, 3), true);
  assert.equal(shouldRetryJob(3, 3), false);
  assert.equal(jobRetryDelayMs(1), 60_000);
  assert.equal(jobRetryDelayMs(3), 240_000);
});
