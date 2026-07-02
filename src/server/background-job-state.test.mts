import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_JOB_TYPES,
  fetchSourceIdFromPayload,
  fetchSourceProcessorForPayload,
  isProcessableBackgroundJobType,
  processableBackgroundJobTypes
} from "./background-job-state.ts";

test("background job processable types are explicit", () => {
  assert.deepEqual(processableBackgroundJobTypes(), [
    BACKGROUND_JOB_TYPES.FETCH_SOURCE,
    BACKGROUND_JOB_TYPES.GENERATE_SUMMARY
  ]);
  assert.equal(isProcessableBackgroundJobType("fetch_source"), true);
  assert.equal(isProcessableBackgroundJobType("ingest_url"), false);
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
