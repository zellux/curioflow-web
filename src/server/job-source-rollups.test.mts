import assert from "node:assert/strict";
import test from "node:test";
import { sourceJobRollupsFromJobs } from "./job-source-rollups.ts";

test("source job rollups group active and failed jobs by source payload", () => {
  assert.deepEqual(
    sourceJobRollupsFromJobs([
      { status: "queued", payloadJson: JSON.stringify({ sourceId: "source-a" }) },
      { status: "running", payloadJson: JSON.stringify({ sourceId: "source-a" }) },
      { status: "failed", payloadJson: JSON.stringify({ sourceId: "source-a" }) },
      { status: "failed", payloadJson: JSON.stringify({ sourceId: "source-b" }) },
      { status: "succeeded", payloadJson: JSON.stringify({ sourceId: "source-a" }) },
      { status: "queued", payloadJson: JSON.stringify({ sourceId: "" }) },
      { status: "queued", payloadJson: "not json" }
    ]),
    [
      { sourceId: "source-a", active: 2, failed: 1, total: 3 },
      { sourceId: "source-b", active: 0, failed: 1, total: 1 }
    ]
  );
});

test("source job rollups sort failed sources before active-only sources", () => {
  assert.deepEqual(
    sourceJobRollupsFromJobs([
      { status: "queued", payloadJson: JSON.stringify({ sourceId: "source-active" }) },
      { status: "failed", payloadJson: JSON.stringify({ sourceId: "source-failed" }) },
      { status: "running", payloadJson: JSON.stringify({ sourceId: "source-active" }) }
    ]),
    [
      { sourceId: "source-failed", active: 0, failed: 1, total: 1 },
      { sourceId: "source-active", active: 2, failed: 0, total: 2 }
    ]
  );
});
