import {
  BACKGROUND_JOB_TYPES,
  fetchSourceProcessorForPayload,
  processableBackgroundJobTypes
} from "@/server/background-job-state";
import { prisma } from "@/server/db";
import { processPodcastSourceJob } from "@/server/ingest/podcast";
import { processRssSourceJob } from "@/server/ingest/rss";
import { JOB_STATUS } from "@/server/job-state";
import { processArticleSummaryJob } from "@/server/summaries";

const DEFAULT_JOB_WAKE_LIMIT = 3;
const STALE_RUNNING_JOB_MS = 30 * 60 * 1000;
const activeBackgroundJobs = new Set<string>();

type BackgroundJobRecord = {
  id: string;
  libraryId: string | null;
  payloadJson: string;
  type: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to process background job";
}

async function markBackgroundJobFailed(jobId: string, error: unknown) {
  await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] }
    },
    data: {
      error: errorMessage(error),
      finishedAt: new Date(),
      status: JOB_STATUS.FAILED
    }
  });
}

async function processBackgroundJob(job: BackgroundJobRecord) {
  if (job.type === BACKGROUND_JOB_TYPES.GENERATE_SUMMARY) {
    await processArticleSummaryJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE) {
    if (fetchSourceProcessorForPayload(job.payloadJson) === "podcast") {
      await processPodcastSourceJob(job.id);
      return;
    }

    await processRssSourceJob(job.id);
  }
}

function startBackgroundJob(job: BackgroundJobRecord) {
  if (activeBackgroundJobs.has(job.id)) return false;
  activeBackgroundJobs.add(job.id);

  void processBackgroundJob(job)
    .catch((error) => markBackgroundJobFailed(job.id, error))
    .finally(() => activeBackgroundJobs.delete(job.id));

  return true;
}

async function requeueStaleBackgroundJobs(libraryId?: string) {
  const cutoff = new Date(Date.now() - STALE_RUNNING_JOB_MS);

  await prisma.job.updateMany({
    where: {
      ...(libraryId ? { libraryId } : {}),
      startedAt: { lt: cutoff },
      status: JOB_STATUS.RUNNING,
      type: { in: processableBackgroundJobTypes() }
    },
    data: {
      error: null,
      finishedAt: null,
      startedAt: null,
      status: JOB_STATUS.QUEUED
    }
  });
}

export async function startQueuedBackgroundJobs({
  libraryId,
  limit = DEFAULT_JOB_WAKE_LIMIT
}: {
  libraryId?: string;
  limit?: number;
} = {}) {
  await requeueStaleBackgroundJobs(libraryId);

  const jobs = await prisma.job.findMany({
    where: {
      ...(libraryId ? { libraryId } : {}),
      status: JOB_STATUS.QUEUED,
      type: { in: processableBackgroundJobTypes() }
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.floor(limit))
  });

  let started = 0;
  for (const job of jobs) {
    if (startBackgroundJob(job)) started += 1;
  }

  return { queued: jobs.length, started };
}
