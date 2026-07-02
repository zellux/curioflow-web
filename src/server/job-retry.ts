import {
  BACKGROUND_JOB_TYPES,
  fetchSourceIdFromPayload,
  jobRetryDelayMs,
  shouldRetryJob
} from "@/server/background-job-state";
import { prisma } from "@/server/db";
import { JOB_STATUS } from "@/server/job-state";
import { serializeJobProgress } from "@/server/job-progress";
import { classifyJobFailure } from "@/server/job-failure";

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
  const message = errorMessage(error);
  const failureCategory = classifyJobFailure(error);
  const data = retry
    ? {
        error: message,
        finishedAt: null,
        lockedUntil: null,
        nextRunAt,
        progressJson: serializeJobProgress({
          stage: "retry_queued",
          failureCategory,
          message,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          nextRunAt: nextRunAt?.toISOString() ?? null
        }, now),
        status: JOB_STATUS.QUEUED
      }
    : {
        error: message,
        finishedAt: now,
        lockedUntil: null,
        nextRunAt: null,
        progressJson: serializeJobProgress({
          stage: "failed",
          failureCategory,
          message,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts
        }, now),
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
