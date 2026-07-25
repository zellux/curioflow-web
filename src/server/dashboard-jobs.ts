import { JOB_STATUS } from "./job-state.ts";

export type DashboardJobCounts = {
  actionable: number;
  active: number;
  failed: number;
};

type DashboardJobRecord = {
  status: string;
};

type FailedSummaryJobRecord = DashboardJobRecord & {
  id: string;
  payloadJson: string;
  type: string;
};

const ACTIVE_JOB_STATUS_SET = new Set<string>([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]);
const SUMMARY_JOB_TYPE = "generate_summary";

function summaryJobItemId(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as { itemId?: unknown };
    return typeof payload.itemId === "string" && payload.itemId.trim() ? payload.itemId : null;
  } catch {
    return null;
  }
}

export function latestFailedSummaryJobsByArticle<T extends FailedSummaryJobRecord>(
  jobs: T[],
  failedArticleIds: Set<string>
) {
  const seenArticleIds = new Set<string>();

  return jobs.filter((job) => {
    if (job.status !== JOB_STATUS.FAILED || job.type !== SUMMARY_JOB_TYPE) return false;
    const itemId = summaryJobItemId(job.payloadJson);
    if (!itemId || !failedArticleIds.has(itemId) || seenArticleIds.has(itemId)) return false;
    seenArticleIds.add(itemId);
    return true;
  });
}

export function dashboardJobCountsFromJobs(
  jobs: DashboardJobRecord[],
  failedArticleCount: number
): DashboardJobCounts {
  const active = jobs.filter((job) => ACTIVE_JOB_STATUS_SET.has(job.status)).length;
  const failed = Math.max(0, Math.floor(failedArticleCount));
  return { actionable: active + failed, active, failed };
}
