import {
  BACKGROUND_JOB_TYPES,
  fetchSourceIdFromPayload,
  fetchSourceProcessorForPayload,
  processableBackgroundJobTypes,
  shouldRetryJob
} from "@/server/background-job-state";
import { prisma } from "@/server/db";
import { processArticleIngestJob, processArticleRefetchJob } from "@/server/ingest/articles";
import { processPodcastSourceJob } from "@/server/ingest/podcast";
import { processRssSourceJob } from "@/server/ingest/rss";
import { JOB_STATUS } from "@/server/job-state";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { processArticleSummaryJob } from "@/server/summaries";

const DEFAULT_JOB_WAKE_LIMIT = 3;
const DEFAULT_JOB_RETRY_LIMIT = 10;
const STALE_RUNNING_JOB_MS = 30 * 60 * 1000;
const activeBackgroundJobs = new Set<string>();

type BackgroundJobRecord = {
  attempts: number;
  id: string;
  libraryId: string | null;
  lockedUntil: Date | null;
  maxAttempts: number;
  nextRunAt: Date | null;
  payloadJson: string;
  type: string;
};

async function processBackgroundJob(job: BackgroundJobRecord) {
  if (job.type === BACKGROUND_JOB_TYPES.INGEST_URL) {
    await processArticleIngestJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.REFETCH_ARTICLE) {
    await processArticleRefetchJob(job.id);
    return;
  }

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
  const now = new Date();
  if (!shouldRetryJob(job.attempts, job.maxAttempts)) return false;
  if (job.nextRunAt && job.nextRunAt > now) return false;
  if (job.lockedUntil && job.lockedUntil > now) return false;
  if (activeBackgroundJobs.has(job.id)) return false;
  activeBackgroundJobs.add(job.id);

  void processBackgroundJob(job)
    .catch((error) => recordBackgroundJobFailure(job.id, error))
    .finally(() => activeBackgroundJobs.delete(job.id));

  return true;
}

async function requeueStaleBackgroundJobs(libraryId?: string) {
  const cutoff = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  const now = new Date();

  await prisma.job.updateMany({
    where: {
      ...(libraryId ? { libraryId } : {}),
      OR: [
        { lockedUntil: { lte: now } },
        { lockedUntil: null, startedAt: { lt: cutoff } }
      ],
      status: JOB_STATUS.RUNNING,
      type: { in: processableBackgroundJobTypes() }
    },
    data: {
      error: null,
      finishedAt: null,
      lockedUntil: null,
      nextRunAt: null,
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
  const now = new Date();

  const jobs = await prisma.job.findMany({
    where: {
      ...(libraryId ? { libraryId } : {}),
      status: JOB_STATUS.QUEUED,
      type: { in: processableBackgroundJobTypes() },
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
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.floor(limit) * 4)
  });
  const exhaustedJobs = jobs.filter((job) => !shouldRetryJob(job.attempts, job.maxAttempts));
  if (exhaustedJobs.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: exhaustedJobs.map((job) => job.id) }, status: JOB_STATUS.QUEUED },
      data: {
        error: "Job reached the maximum retry attempts.",
        finishedAt: new Date(),
        lockedUntil: null,
        nextRunAt: null,
        status: JOB_STATUS.FAILED
      }
    });
  }

  const eligibleJobs = jobs
    .filter((job) => shouldRetryJob(job.attempts, job.maxAttempts))
    .slice(0, Math.max(1, Math.floor(limit)));

  let started = 0;
  for (const job of eligibleJobs) {
    if (startBackgroundJob(job)) started += 1;
  }

  return { queued: eligibleJobs.length, started };
}

export async function requeueFailedBackgroundJobs({
  libraryId,
  limit = DEFAULT_JOB_RETRY_LIMIT
}: {
  libraryId: string;
  limit?: number;
}) {
  const jobs = await prisma.job.findMany({
    where: {
      libraryId,
      status: JOB_STATUS.FAILED,
      type: { in: processableBackgroundJobTypes() }
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.floor(limit))
  });

  if (jobs.length === 0) return { requeued: 0, started: 0 };

  const jobUpdates = jobs.map((job) => prisma.job.update({
    where: { id: job.id },
    data: {
      error: null,
      finishedAt: null,
      attempts: 0,
      lockedUntil: null,
      nextRunAt: null,
      startedAt: null,
      status: JOB_STATUS.QUEUED
    }
  }));
  const sourceUpdates = jobs
    .filter((job) => job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE)
    .map((job) => fetchSourceIdFromPayload(job.payloadJson))
    .filter((sourceId): sourceId is string => Boolean(sourceId))
    .map((sourceId) => prisma.source.updateMany({
      where: { id: sourceId, libraryId },
      data: { status: "importing" }
    }));

  await prisma.$transaction([...jobUpdates, ...sourceUpdates]);
  const wake = await startQueuedBackgroundJobs({ libraryId, limit: jobs.length });
  return { requeued: jobs.length, started: wake.started };
}
