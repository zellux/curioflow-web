import assert from "node:assert/strict";
import test from "node:test";
import { nextSourceFetchAt, normalizeSourceRefreshInterval, sourceFailureNextFetchAt } from "./source-schedule.ts";

test("source scheduling applies bounded jitter and failure backoff", () => {
  const now = new Date("2026-07-09T00:00:00Z");
  assert.equal(nextSourceFetchAt(60, now, 0).toISOString(), "2026-07-09T00:54:00.000Z");
  assert.equal(nextSourceFetchAt(60, now, 1).toISOString(), "2026-07-09T01:06:00.000Z");
  assert.equal(sourceFailureNextFetchAt(1, now).toISOString(), "2026-07-09T00:15:00.000Z");
  assert.equal(sourceFailureNextFetchAt(10, now).toISOString(), "2026-07-09T06:00:00.000Z");
});

test("source refresh cadence is normalized to supported bounds", () => {
  assert.equal(normalizeSourceRefreshInterval(60), 60);
  assert.equal(normalizeSourceRefreshInterval("360"), 360);
  assert.equal(normalizeSourceRefreshInterval(1), 15);
  assert.equal(normalizeSourceRefreshInterval(10_000), 1440);
  assert.equal(normalizeSourceRefreshInterval("invalid"), 60);
});
