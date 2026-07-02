import { prisma } from "@/server/db";
import { JOB_STATUS } from "@/server/job-state";
import { shouldRetryJob } from "@/server/background-job-state";
import { serializeJobProgress } from "@/server/job-progress";
import { JOB_FAILURE_CATEGORIES } from "@/server/job-failure";

const JOB_LEASE_MS = 30 * 60 * 1000;

type ClaimableJob = {
  attempts: number;
  id: string;
  lockedUntil: Date | null;
  maxAttempts: number;
  nextRunAt: Date | null;
  startedAt: Date | null;
  status: string;
};

export async function claimQueuedJob(job: ClaimableJob) {
  if (job.status !== JOB_STATUS.QUEUED) return false;
  if (!shouldRetryJob(job.attempts, job.maxAttempts)) {
    await prisma.job.updateMany({
      where: {
        id: job.id,
        status: JOB_STATUS.QUEUED
      },
      data: {
        error: "Job reached the maximum retry attempts.",
        finishedAt: new Date(),
        lockedUntil: null,
        nextRunAt: null,
        progressJson: serializeJobProgress({
          stage: "failed",
          failureCategory: JOB_FAILURE_CATEGORIES.RETRY,
          message: "Job reached the maximum retry attempts.",
          attempts: job.attempts,
          maxAttempts: job.maxAttempts
        }),
        status: JOB_STATUS.FAILED
      }
    });
    return false;
  }

  const now = new Date();
  if (job.nextRunAt && job.nextRunAt > now) return false;
  if (job.lockedUntil && job.lockedUntil > now) return false;

  const result = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: JOB_STATUS.QUEUED,
      AND: [
        {
          OR: [
            { nextRunAt: null },
            { nextRunAt: { lte: now } }
          ]
        },
        {
          OR: [
            { lockedUntil: null },
            { lockedUntil: { lte: now } }
          ]
        }
      ]
    },
    data: {
      attempts: { increment: 1 },
      error: null,
      finishedAt: null,
      lockedUntil: new Date(now.getTime() + JOB_LEASE_MS),
      nextRunAt: null,
      progressJson: serializeJobProgress({
        stage: "running",
        attempts: job.attempts + 1,
        maxAttempts: job.maxAttempts
      }, now),
      startedAt: job.startedAt ?? now,
      status: JOB_STATUS.RUNNING
    }
  });

  return result.count === 1;
}
