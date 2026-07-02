import { prisma } from "@/server/db";
import { JOB_STATUS } from "@/server/job-state";

type ClaimableJob = {
  id: string;
  startedAt: Date | null;
  status: string;
};

export async function claimQueuedJob(job: ClaimableJob) {
  if (job.status !== JOB_STATUS.QUEUED) return false;

  const result = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: JOB_STATUS.QUEUED
    },
    data: {
      error: null,
      finishedAt: null,
      startedAt: job.startedAt ?? new Date(),
      status: JOB_STATUS.RUNNING
    }
  });

  return result.count === 1;
}
