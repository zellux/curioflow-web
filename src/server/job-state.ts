export const JOB_STATUS = {
  FAILED: "failed",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded"
} as const;

export type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

const ACTIVE_JOB_STATUSES = new Set<string>([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]);
const ACTIONABLE_JOB_STATUSES = [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING, JOB_STATUS.FAILED] as const;

export function isActiveJobStatus(status: string | null | undefined) {
  return Boolean(status && ACTIVE_JOB_STATUSES.has(status));
}

export function isFailedJobStatus(status: string | null | undefined) {
  return status === JOB_STATUS.FAILED;
}

export function actionableJobStatuses() {
  return [...ACTIONABLE_JOB_STATUSES];
}
