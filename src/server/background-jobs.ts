import {
  BACKGROUND_JOB_TYPES,
  dedupeRetryJobsByArticle,
  fetchSourceIdFromPayload,
  fetchSourceProcessorForPayload,
  isFailedRssFetchSourceJob,
  processableBackgroundJobTypes,
  shouldRetryJob
} from "@/server/background-job-state";
import { prisma } from "@/server/db";
import { processArticleIngestJob, processArticleRefetchJob } from "@/server/ingest/articles";
import { processPodcastSourceJob, processPodcastTranscriptionJob } from "@/server/ingest/podcast";
import { processRssSourceJob } from "@/server/ingest/rss";
import { processPdfJob } from "@/server/ingest/pdf";
import { JOB_STATUS } from "@/server/job-state";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { serializeJobProgress } from "@/server/job-progress";
import { JOB_FAILURE_CATEGORIES } from "@/server/job-failure";
import { startArticleSummaryJob } from "@/server/summaries";
import { nextSourceFetchAt } from "@/server/source-schedule";
import { cleanupExpiredAccountExports, processAccountExportJob } from "@/server/account-exports";

const DEFAULT_JOB_WAKE_LIMIT = 3;
const JOB_SCHEDULER_INTERVAL_MS = 30_000;
const STALE_RUNNING_JOB_MS = 30 * 60 * 1000;
const activeBackgroundJobs = new Set<string>();
let schedulerStarted = false;
let lastExportCleanupAt = 0;

export async function scheduleDueSourceJobs(limit = 20) {
  const now = new Date();
  const [sources, activeJobs] = await Promise.all([
    prisma.source.findMany({
      where: {
        type: { in: ["rss", "podcast"] },
        status: { in: ["active", "error"] },
        url: { not: null },
        OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }]
      },
      orderBy: [{ nextFetchAt: "asc" }, { lastCheckedAt: "asc" }],
      take: Math.max(1, Math.floor(limit))
    }),
    prisma.job.findMany({
      where: { type: BACKGROUND_JOB_TYPES.FETCH_SOURCE, status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] } },
      select: { payloadJson: true }
    })
  ]);
  const activeSourceIds = new Set(activeJobs.map((job) => fetchSourceIdFromPayload(job.payloadJson)).filter(Boolean));
  let queued = 0;

  for (const source of sources) {
    if (!source.url || activeSourceIds.has(source.id)) continue;
    const nextFetchAt = nextSourceFetchAt(source.refreshIntervalMinutes, now);
    const job = await prisma.$transaction(async (tx) => {
      const claimed = await tx.source.updateMany({
        where: { id: source.id, nextFetchAt: source.nextFetchAt },
        data: { nextFetchAt }
      });
      if (claimed.count === 0) return null;
      return tx.job.create({
        data: {
          libraryId: source.libraryId,
          type: BACKGROUND_JOB_TYPES.FETCH_SOURCE,
          status: JOB_STATUS.QUEUED,
          progressJson: serializeJobProgress({ stage: "queued", sourceId: source.id, feedUrl: source.url }),
          payloadJson: JSON.stringify({
            sourceId: source.id,
            feedUrl: source.url,
            ...(source.type === "podcast" ? { feedTitle: source.name } : {}),
            generateSummary: true,
            savedToLibrary: source.type === "rss" ? source.autoSaveToLibrary : false
          })
        }
      });
    });
    if (job) queued += 1;
  }
  return { queued };
}

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
  if (job.type === BACKGROUND_JOB_TYPES.EXPORT_ACCOUNT) {
    await processAccountExportJob(job.id);
    return;
  }
  if (job.type === BACKGROUND_JOB_TYPES.INGEST_URL) {
    await processArticleIngestJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.REFETCH_ARTICLE) {
    await processArticleRefetchJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.PARSE_PDF) {
    await processPdfJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.TRANSCRIBE_PODCAST) {
    await processPodcastTranscriptionJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.GENERATE_SUMMARY) {
    await startArticleSummaryJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE) {
    if (fetchSourceProcessorForPayload(job.payloadJson) === "podcast") {
      await processPodcastSourceJob(job.id);
    } else {
      await processRssSourceJob(job.id);
    }

    if (job.libraryId) {
      await startQueuedBackgroundJobs({ libraryId: job.libraryId, limit: DEFAULT_JOB_WAKE_LIMIT });
    }
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
      leaseOwner: null,
      nextRunAt: null,
      progressJson: serializeJobProgress({
        stage: "queued",
        message: "Requeued after a stale worker lease."
      }),
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
        leaseOwner: null,
        nextRunAt: null,
        progressJson: serializeJobProgress({
          stage: "failed",
          failureCategory: JOB_FAILURE_CATEGORIES.RETRY,
          message: "Job reached the maximum retry attempts."
        }),
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
  excludeFailedRssSourceJobs = false,
  libraryId,
  limit
}: {
  excludeFailedRssSourceJobs?: boolean;
  libraryId: string;
  limit?: number;
}) {
  const [failedJobs, rssSources] = await Promise.all([
    prisma.job.findMany({
      where: {
        libraryId,
        status: JOB_STATUS.FAILED,
        type: { in: processableBackgroundJobTypes() }
      },
      include: {
        contentObject: { select: { type: true } }
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }]
    }),
    excludeFailedRssSourceJobs
      ? prisma.source.findMany({
          where: {
            libraryId,
            type: "rss",
            status: { not: "unsubscribed" }
          },
          select: { id: true }
        })
      : Promise.resolve([])
  ]);
  const rssSourceIds = new Set(rssSources.map((source) => source.id));
  const retryLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(Number(limit))) : null;
  const retryableJobs = dedupeRetryJobsByArticle(failedJobs
    .filter((job) => !excludeFailedRssSourceJobs || !isFailedRssFetchSourceJob(job, rssSourceIds)));
  const jobs = retryLimit ? retryableJobs.slice(0, retryLimit) : retryableJobs;

  if (jobs.length === 0) return { requeued: 0, started: 0 };

  const jobUpdates = jobs.map((job) => prisma.job.update({
    where: { id: job.id },
    data: {
      error: null,
      finishedAt: null,
      attempts: 0,
      lockedUntil: null,
      leaseOwner: null,
      nextRunAt: null,
      progressJson: serializeJobProgress({
        stage: "queued",
        message: "Manually retried failed job."
      }),
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

export function ensureBackgroundJobScheduler() {
  if (schedulerStarted || process.env.CURIOFLOW_DISABLE_JOB_SCHEDULER === "true") return;
  schedulerStarted = true;

  const tick = () => {
    if (Date.now() - lastExportCleanupAt >= 60 * 60 * 1000) {
      lastExportCleanupAt = Date.now();
      void cleanupExpiredAccountExports().catch((error) => {
        console.error("Curioflow account export cleanup failed", error);
      });
    }
    void scheduleDueSourceJobs()
      .then(() => startQueuedBackgroundJobs({ limit: DEFAULT_JOB_WAKE_LIMIT }))
      .catch((error) => {
      console.error("Curioflow background job scheduler failed", error);
    });
  };

  tick();
  const interval = setInterval(tick, JOB_SCHEDULER_INTERVAL_MS);
  interval.unref?.();
}
