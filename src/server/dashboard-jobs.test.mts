import assert from "node:assert/strict";
import test from "node:test";
import { dashboardJobCountsFromJobs, latestFailedSummaryJobsByArticle } from "./dashboard-jobs.ts";
import { JOB_STATUS } from "./job-state.ts";

test("dashboard job counts use active tasks but failed articles", () => {
  assert.deepEqual(
    dashboardJobCountsFromJobs([
      { status: JOB_STATUS.QUEUED },
      { status: JOB_STATUS.RUNNING },
      { status: JOB_STATUS.FAILED },
      { status: JOB_STATUS.FAILED }
    ], 1),
    { actionable: 3, active: 2, failed: 1 }
  );
});

test("dashboard job counts clear failures after the article succeeds", () => {
  assert.deepEqual(
    dashboardJobCountsFromJobs([
      { status: JOB_STATUS.FAILED },
      { status: JOB_STATUS.SUCCEEDED }
    ], 0),
    { actionable: 0, active: 0, failed: 0 }
  );
});

test("dashboard keeps only the latest failed summary task for each currently failed article", () => {
  const jobs = [
    {
      id: "article-1-retry",
      payloadJson: JSON.stringify({ itemId: "article-1" }),
      status: JOB_STATUS.FAILED,
      type: "generate_summary"
    },
    {
      id: "article-1-initial",
      payloadJson: JSON.stringify({ itemId: "article-1" }),
      status: JOB_STATUS.FAILED,
      type: "generate_summary"
    },
    {
      id: "article-2-old-failure",
      payloadJson: JSON.stringify({ itemId: "article-2" }),
      status: JOB_STATUS.FAILED,
      type: "generate_summary"
    },
    {
      id: "article-ingest-failure",
      payloadJson: JSON.stringify({ itemId: "article-1" }),
      status: JOB_STATUS.FAILED,
      type: "ingest_url"
    }
  ];

  assert.deepEqual(
    latestFailedSummaryJobsByArticle(jobs, new Set(["article-1"])).map((job) => job.id),
    ["article-1-retry"]
  );
});
