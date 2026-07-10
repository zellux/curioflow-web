import assert from "node:assert/strict";
import test from "node:test";
import { assertJobLeaseUpdated, fencedJobWhere, JobLeaseLostError } from "./job-lease.ts";

const lease = { jobId: "job-1", owner: "worker-1", version: 3 };

test("job writes are fenced by owner, version, and running state", () => {
  assert.deepEqual(fencedJobWhere(lease), {
    id: "job-1",
    leaseOwner: "worker-1",
    leaseVersion: 3,
    status: "running"
  });
});

test("a stale lease cannot silently complete a job", () => {
  assert.doesNotThrow(() => assertJobLeaseUpdated(1, lease));
  assert.throws(() => assertJobLeaseUpdated(0, lease), JobLeaseLostError);
});
