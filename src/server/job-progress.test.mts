import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobProgress,
  serializeJobProgress
} from "./job-progress.ts";

const NOW = new Date("2026-07-02T08:00:00.000Z");

test("job progress normalizes stage and updated time", () => {
  assert.deepEqual(buildJobProgress({ stage: " extracting " }, NOW), {
    stage: "extracting",
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("job progress clamps percentage inputs", () => {
  assert.deepEqual(buildJobProgress({ stage: "indexing", current: 12, total: 10 }, NOW), {
    stage: "indexing",
    updatedAt: "2026-07-02T08:00:00.000Z",
    total: 10,
    current: 12,
    percent: 100
  });
});

test("job progress omits undefined and non-finite values", () => {
  assert.deepEqual(
    buildJobProgress({
      stage: "",
      current: Number.NaN,
      total: Number.POSITIVE_INFINITY,
      message: undefined,
      sourceId: "source-1"
    }, NOW),
    {
      stage: "working",
      updatedAt: "2026-07-02T08:00:00.000Z",
      sourceId: "source-1"
    }
  );
});

test("job progress serializes stable JSON", () => {
  assert.equal(
    serializeJobProgress({ stage: "queued", current: 1, total: 4 }, NOW),
    "{\"stage\":\"queued\",\"updatedAt\":\"2026-07-02T08:00:00.000Z\",\"total\":4,\"current\":1,\"percent\":25}"
  );
});
