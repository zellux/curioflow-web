import { JOB_STATUS } from "./job-state.ts";

export type JobLease = {
  jobId: string;
  owner: string;
  version: number;
};

export class JobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Job lease lost for ${jobId}`);
    this.name = "JobLeaseLostError";
  }
}

export function fencedJobWhere(lease: JobLease) {
  return {
    id: lease.jobId,
    leaseOwner: lease.owner,
    leaseVersion: lease.version,
    status: JOB_STATUS.RUNNING
  };
}

export function assertJobLeaseUpdated(count: number, lease: JobLease) {
  if (count === 0) throw new JobLeaseLostError(lease.jobId);
}
