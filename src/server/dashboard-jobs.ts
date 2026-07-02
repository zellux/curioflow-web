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

const ACTIVE_JOB_STATUS_SET = new Set<string>([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]);

export function dashboardJobCountsFromGroups(groups: DashboardJobGroup[]): DashboardJobCounts {
  return groups.reduce<DashboardJobCounts>(
    (counts, group) => {
      const count = group._count._all;
      if (group.status === JOB_STATUS.FAILED) {
        counts.failed += count;
        counts.actionable += count;
        return counts;
      }

      if (ACTIVE_JOB_STATUS_SET.has(group.status)) {
        counts.active += count;
        counts.actionable += count;
      }

      return counts;
    },
    { actionable: 0, active: 0, failed: 0 }
  );
}
