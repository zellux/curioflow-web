import { JOB_STATUS } from "./job-state.ts";

export type DashboardJobCounts = {
  actionable: number;
  active: number;
  failed: number;
};

type DashboardJobGroup = {
  status: string;
  _count: {
    _all: number;
  };
};

type DashboardJobRecord = {
  status: string;
};

const ACTIVE_JOB_STATUS_SET = new Set<string>([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]);

function addJobStatusCount(counts: DashboardJobCounts, status: string, count: number) {
  if (status === JOB_STATUS.FAILED) {
    counts.failed += count;
    counts.actionable += count;
    return counts;
  }

  if (ACTIVE_JOB_STATUS_SET.has(status)) {
    counts.active += count;
    counts.actionable += count;
  }

  return counts;
}

export function dashboardJobCountsFromJobs(jobs: DashboardJobRecord[]): DashboardJobCounts {
  return jobs.reduce<DashboardJobCounts>(
    (counts, job) => addJobStatusCount(counts, job.status, 1),
    { actionable: 0, active: 0, failed: 0 }
  );
}

export function dashboardJobCountsFromGroups(groups: DashboardJobGroup[]): DashboardJobCounts {
  return groups.reduce<DashboardJobCounts>(
    (counts, group) => addJobStatusCount(counts, group.status, group._count._all),
    { actionable: 0, active: 0, failed: 0 }
  );
}
