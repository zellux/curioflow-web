import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { JOB_STATUS } from "@/server/job-state";
import { shouldRetryJob } from "@/server/background-job-state";
import { serializeJobProgress } from "@/server/job-progress";
import { JOB_FAILURE_CATEGORIES } from "@/server/job-failure";
import {
  fencedJobWhere,
  JobLeaseLostError,
  type JobLease
} from "@/server/job-lease";

const JOB_LEASE_MS = 30 * 60 * 1000;
const JOB_HEARTBEAT_MS = 5 * 60 * 1000;
const PROCESS_LEASE_OWNER = `${process.env.HOSTNAME ?? "worker"}:${randomUUID()}`;
const leaseHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

export { assertJobLeaseUpdated, fencedJobWhere, JobLeaseLostError, type JobLease } from "@/server/job-lease";

type ClaimableJob = {
  attempts: number;
  id: string;
  lockedUntil: Date | null;
  leaseVersion: number;
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
        leaseOwner: null,
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
      leaseOwner: PROCESS_LEASE_OWNER,
      leaseVersion: { increment: 1 },
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

  if (result.count !== 1) return false;
  const lease = { jobId: job.id, owner: PROCESS_LEASE_OWNER, version: job.leaseVersion + 1 };
  startLeaseHeartbeat(lease);
  return lease;
}

export async function assertJobLease(tx: Prisma.TransactionClient, lease: JobLease) {
  const job = await tx.job.findFirst({
    where: fencedJobWhere(lease),
    select: { id: true }
  });
  if (!job) throw new JobLeaseLostError(lease.jobId);
}

function startLeaseHeartbeat(lease: JobLease) {
  const existing = leaseHeartbeats.get(lease.jobId);
  if (existing) clearInterval(existing);
  const interval = setInterval(() => {
    void prisma.job.updateMany({
      where: fencedJobWhere(lease),
      data: { lockedUntil: new Date(Date.now() + JOB_LEASE_MS) }
    }).then((result) => {
      if (result.count === 0) {
        clearInterval(interval);
        leaseHeartbeats.delete(lease.jobId);
      }
    });
  }, JOB_HEARTBEAT_MS);
  interval.unref?.();
  leaseHeartbeats.set(lease.jobId, interval);
}
