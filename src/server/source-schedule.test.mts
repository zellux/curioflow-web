import assert from "node:assert/strict";
import test from "node:test";
import { nextSourceFetchAt, sourceFailureNextFetchAt } from "./source-schedule.ts";

test("source scheduling applies bounded jitter and failure backoff", () => {
  const now = new Date("2026-07-09T00:00:00Z");
  assert.equal(nextSourceFetchAt(60, now, 0).toISOString(), "2026-07-09T00:54:00.000Z");
  assert.equal(nextSourceFetchAt(60, now, 1).toISOString(), "2026-07-09T01:06:00.000Z");
  assert.equal(sourceFailureNextFetchAt(1, now).toISOString(), "2026-07-09T00:15:00.000Z");
  assert.equal(sourceFailureNextFetchAt(10, now).toISOString(), "2026-07-09T06:00:00.000Z");
});
