import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatHealth, safeTaskProgress } from "./task-monitor-state.ts";

test("worker health distinguishes startup, failed checks, and loss of heartbeat", () => {
  const now = new Date("2026-09-21T00:00:00Z");
  const stale = new Date(now.getTime() - 91_000);
  assert.equal(heartbeatHealth(null, null, now), "unknown");
  assert.equal(heartbeatHealth(stale, stale, now), "offline");
  assert.equal(heartbeatHealth(now, stale, now), "degraded");
  assert.equal(heartbeatHealth(now, now, now), "online");
});

test("monitor projections never return raw payload, errors, or arbitrary progress messages", () => {
  assert.deepEqual(safeTaskProgress('{"percent":150,"failureCategory":"network","message":"api-secret","outcome":"quarantined"}'), {
    percent: 100, failureCategory: "network", outcome: "quarantined"
  });
  assert.deepEqual(safeTaskProgress("not JSON"), { percent: null, failureCategory: "unknown", outcome: null });
  assert.deepEqual(safeTaskProgress("null"), { percent: null, failureCategory: "unknown", outcome: null });
});
