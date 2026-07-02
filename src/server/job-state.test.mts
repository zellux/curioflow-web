import assert from "node:assert/strict";
import test from "node:test";
import { actionableJobStatuses, isActiveJobStatus, isFailedJobStatus, JOB_STATUS } from "./job-state.ts";

test("active job statuses are queued and running", () => {
  assert.equal(isActiveJobStatus(JOB_STATUS.QUEUED), true);
  assert.equal(isActiveJobStatus(JOB_STATUS.RUNNING), true);
  assert.equal(isActiveJobStatus(JOB_STATUS.SUCCEEDED), false);
  assert.equal(isActiveJobStatus(JOB_STATUS.FAILED), false);
});

test("failed job status is handled separately from active work", () => {
  assert.equal(isFailedJobStatus(JOB_STATUS.FAILED), true);
  assert.equal(isFailedJobStatus(JOB_STATUS.RUNNING), false);
});

test("dashboard job statuses only include actionable jobs", () => {
  assert.deepEqual(actionableJobStatuses(), [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING, JOB_STATUS.FAILED]);
});
