import {
  BACKGROUND_JOB_TYPES,
  fetchSourceIdFromPayload,
  jobRetryDelayMs,
  shouldRetryJob
} from "@/server/background-job-state";
import { prisma } from "@/server/db";
import { JOB_STATUS } from "@/server/job-state";

export type JobFailureResult =
  | { status: "ignored" }
  | { status: "queued"; nextRunAt: Date }
  | { status: "failed" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to process background job";
}

export async function recordBackgroundJobFailure(jobId: string, error: unknown): Promise<JobFailureResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { status: "ignored" };

  const retry = shouldRetryJob(job.attempts, job.maxAttempts);
  const now = new Date();
  const nextRunAt = retry ? new Date(now.getTime() + jobRetryDelayMs(job.attempts)) : null;
  const data = retry
    ? {
        error: errorMessage(error),
        finishedAt: null,
        lockedUntil: null,
        nextRunAt,
        status: JOB_STATUS.QUEUED
      }
    : {
        error: errorMessage(error),
        finishedAt: now,
        lockedUntil: null,
        nextRunAt: null,
        status: JOB_STATUS.FAILED
      };

  const updates = [
    prisma.job.updateMany({
      where: {
        id: jobId,
        status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING, JOB_STATUS.FAILED] }
      },
      data
    })
  ];
  const sourceId = job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE ? fetchSourceIdFromPayload(job.payloadJson) : null;
  if (retry && sourceId && job.libraryId) {
    updates.push(prisma.source.updateMany({
      where: { id: sourceId, libraryId: job.libraryId },
      data: { status: "importing" }
    }));
  }

  await prisma.$transaction(updates);
  return retry && nextRunAt ? { status: "queued", nextRunAt } : { status: "failed" };
}
