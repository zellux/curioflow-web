import assert from "node:assert/strict";
import test from "node:test";
import { dashboardJobCountsFromGroups } from "./dashboard-jobs.ts";
import { JOB_STATUS } from "./job-state.ts";

test("dashboard job counts separate active and failed jobs", () => {
  assert.deepEqual(
    dashboardJobCountsFromGroups([
      { status: JOB_STATUS.QUEUED, _count: { _all: 4 } },
      { status: JOB_STATUS.RUNNING, _count: { _all: 2 } },
      { status: JOB_STATUS.FAILED, _count: { _all: 3 } }
    ]),
    { actionable: 9, active: 6, failed: 3 }
  );
});

test("dashboard job counts ignore non-actionable statuses", () => {
  assert.deepEqual(
    dashboardJobCountsFromGroups([
      { status: JOB_STATUS.SUCCEEDED, _count: { _all: 8 } },
      { status: "paused", _count: { _all: 1 } }
    ]),
    { actionable: 0, active: 0, failed: 0 }
  );
});
