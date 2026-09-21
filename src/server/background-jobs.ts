import { enqueueSourceJob, activeSourceJob } from "@/server/source-jobs";
import { recordWorkerHeartbeat } from "@/server/worker-heartbeat";
import { processNewsletterJob } from "@/server/newsletter-jobs";
import { cleanupOrphanedArticleImageDirectories } from "@/server/article-image-cleanup";
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
import { processRssSourceJob } from "@/server/ingest/rss";
import { processPdfJob } from "@/server/ingest/pdf";
import { JOB_STATUS } from "@/server/job-state";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { serializeJobProgress } from "@/server/job-progress";
import { JOB_FAILURE_CATEGORIES } from "@/server/job-failure";
import { startArticleSummaryJob } from "@/server/summaries";
import { nextSourceFetchAt } from "@/server/source-schedule";
import { cleanupExpiredAccountExports, processAccountExportJob } from "@/server/account-exports";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";
import { startBackgroundExecution } from "@/server/background-execution";

const DEFAULT_JOB_WAKE_LIMIT = 3;
const JOB_SCHEDULER_INTERVAL_MS = 30_000;
const STALE_RUNNING_JOB_MS = 30 * 60 * 1000;
let schedulerStarted = false;
let lastExportCleanupAt = 0;
let lastImageCleanupAt = 0;
let imageCleanupRunning = false;

export async function scheduleDueSourceJobs(limit = 20) {
  if (!backgroundWorkRunsHere()) return { queued: 0 };
  const now = new Date();
  const activeJobs = await prisma.job.findMany({
    where: { type: BACKGROUND_JOB_TYPES.FETCH_SOURCE, status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] } },
    select: { sourceId: true, payloadJson: true }
  });
  const activeSourceIds = activeJobs.map(job => job.sourceId ?? fetchSourceIdFromPayload(job.payloadJson))
    .filter((id): id is string => Boolean(id));
  const sources = await prisma.source.findMany({
    where: {
      id: { notIn: activeSourceIds },
      type: "rss",
      status: { in: ["active", "error", "importing"] },
      url: { not: null },
      OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }]
    },
    orderBy: [{ nextFetchAt: "asc" }, { lastCheckedAt: "asc" }],
    take: Math.max(1, Math.floor(limit))
  });
  let queued = 0;
  for (const source of sources) {
    if (!source.url) continue;
    await enqueueSourceJob({ data: {
      sourceId: source.id,
      libraryId: source.libraryId,
      type: BACKGROUND_JOB_TYPES.FETCH_SOURCE,
      status: JOB_STATUS.QUEUED,
      progressJson: serializeJobProgress({ stage: "queued", sourceId: source.id }),
      payloadJson: JSON.stringify({
        sourceId: source.id, feedUrl: source.url,
        generateSummary: true,
        savedToLibrary: source.autoSaveToLibrary
      })
    } });
    // Advance only after durable enqueue; a crash before this update is safe to replay.
    await prisma.source.updateMany({
      where: { id: source.id, nextFetchAt: source.nextFetchAt },
      data: { nextFetchAt: nextSourceFetchAt(source.refreshIntervalMinutes, now) }
    });
    queued += 1;
  }
  return { queued };
}

type BackgroundJobRecord = {
  attempts: number;
  leaseVersion: number;
  id: string;
  libraryId: string | null;
  lockedUntil: Date | null;
  maxAttempts: number;
  nextRunAt: Date | null;
  payloadJson: string;
  type: string;
};

async function processBackgroundJob(job: BackgroundJobRecord) {
  if (job.type === BACKGROUND_JOB_TYPES.INGEST_NEWSLETTER) {
    await processNewsletterJob(job.id);
    return;
  }
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

  if (job.type === BACKGROUND_JOB_TYPES.GENERATE_SUMMARY) {
    await startArticleSummaryJob(job.id);
    return;
  }

  if (job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE) {
    if (fetchSourceProcessorForPayload(job.payloadJson) === "podcast") {
      // Old queued jobs must never be processed as RSS after feature removal.
      await prisma.job.updateMany({
        where: { id: job.id, status: "queued", leaseVersion: job.leaseVersion },
        data: { status: "cancelled", finishedAt: new Date(), lockedUntil: null, leaseOwner: null, nextRunAt: null }
      });
    } else {
      await processRssSourceJob(job.id);
    }

    if (job.libraryId) {
      await startQueuedBackgroundJobs({ libraryId: job.libraryId, limit: DEFAULT_JOB_WAKE_LIMIT });
    }
  }
}

async function startBackgroundJob(job: BackgroundJobRecord) {
  const now = new Date();
  if (!shouldRetryJob(job.attempts, job.maxAttempts)) return false;
  if (job.nextRunAt && job.nextRunAt > now) return false;
  if (job.lockedUntil && job.lockedUntil > now) return false;
  if (job.type === BACKGROUND_JOB_TYPES.GENERATE_SUMMARY) return startArticleSummaryJob(job.id);
  return startBackgroundExecution(job.id, async () => {
    try { await processBackgroundJob(job); }
    catch (error) { await recordBackgroundJobFailure(job.id, error); }
  }, job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE || job.type === BACKGROUND_JOB_TYPES.INGEST_NEWSLETTER);
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
  if (!backgroundWorkRunsHere()) return { queued: 0, started: 0 };
  await requeueStaleBackgroundJobs(libraryId);
  const now = new Date();

  const baseWhere = {
      ...(libraryId ? { libraryId } : {}),
      status: JOB_STATUS.QUEUED,
      AND: [
        { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
        { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }
      ]
  };
  const ingestionTypes = [BACKGROUND_JOB_TYPES.FETCH_SOURCE, BACKGROUND_JOB_TYPES.INGEST_NEWSLETTER];
  const ingestionJobs = await prisma.job.findMany({
    where: { ...baseWhere, type: { in: ingestionTypes } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.floor(limit))
  });
  const otherJobs = await prisma.job.findMany({
    where: {
      ...(libraryId ? { libraryId } : {}),
      status: JOB_STATUS.QUEUED,
      type: { in: processableBackgroundJobTypes().filter(type => !ingestionTypes.includes(type as typeof ingestionTypes[number])) },
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
  const jobs = [...ingestionJobs.slice(0, 1), ...otherJobs, ...ingestionJobs.slice(1)];
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
    .filter((job) => shouldRetryJob(job.attempts, job.maxAttempts));

  let started = 0;
  for (const job of eligibleJobs) {
    if (await startBackgroundJob(job)) started += 1;
    if (started >= Math.max(1, Math.floor(limit))) break;
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
  const availableJobs = [];
  const seenSources = new Set<string>();
  for (const job of retryableJobs) {
    const sourceId = job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE ? fetchSourceIdFromPayload(job.payloadJson) : null;
    if (sourceId) {
      const source = await prisma.source.findFirst({ where: { id: sourceId, libraryId, status: { in: ["active", "error", "importing"] } }, select: { id: true } });
      if (!source || seenSources.has(sourceId) || await activeSourceJob(sourceId, libraryId)) continue;
      seenSources.add(sourceId);
    }
    availableJobs.push(job);
  }
  const jobs = retryLimit ? availableJobs.slice(0, retryLimit) : availableJobs;

  if (jobs.length === 0) return { requeued: 0, started: 0 };

  const jobUpdates = jobs.map((job) => prisma.job.update({
    where: { id: job.id },
    data: {
      sourceId: job.type === BACKGROUND_JOB_TYPES.FETCH_SOURCE ? fetchSourceIdFromPayload(job.payloadJson) : job.sourceId,
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
      where: { id: sourceId, libraryId, status: { in: ["active", "error", "importing"] } },
      data: { status: "importing" }
    }));

  await prisma.$transaction([...jobUpdates, ...sourceUpdates]);
  const wake = await startQueuedBackgroundJobs({ libraryId, limit: jobs.length });
  return { requeued: jobs.length, started: wake.started };
}

export function ensureBackgroundJobScheduler() {
  if (!backgroundWorkRunsHere()) return;
  if (schedulerStarted || process.env.CURIOFLOW_DISABLE_JOB_SCHEDULER === "true") return;
  schedulerStarted = true;

  let tickRunning = false;
  const tick = () => {
    if (tickRunning) return;
    tickRunning = true;
    if (!imageCleanupRunning && Date.now() - lastImageCleanupAt >= 5 * 60 * 1000) {
      lastImageCleanupAt = Date.now();
      imageCleanupRunning = true;
      void cleanupOrphanedArticleImageDirectories()
        .catch(() => console.error("Article image maintenance failed"))
        .finally(() => { imageCleanupRunning = false; });
    }
    if (Date.now() - lastExportCleanupAt >= 60 * 60 * 1000) {
      lastExportCleanupAt = Date.now();
      void cleanupExpiredAccountExports().catch((error) => {
        console.error("Curioflow account export cleanup failed", error);
      });
    }
    void recordWorkerHeartbeat("scheduler")
      .then(() => scheduleDueSourceJobs())
      .then(() => startQueuedBackgroundJobs({ limit: DEFAULT_JOB_WAKE_LIMIT }))
      .then(() => recordWorkerHeartbeat("scheduler", true))
      .catch((error) => {
      console.error("Curioflow background job scheduler failed", error);
    }).finally(() => { tickRunning = false; });
  };

  tick();
  const interval = setInterval(tick, JOB_SCHEDULER_INTERVAL_MS);
  interval.unref?.();
}
