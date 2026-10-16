import { getArticleIssues } from "@/server/article-issues";
import { Prisma, type Job } from "@prisma/client";
import { prisma } from "@/server/db";
import { fetchSourceIdFromPayload, isProcessableBackgroundJobType, processableBackgroundJobTypes } from "@/server/background-job-state";
import { activeSourceJob } from "@/server/source-jobs";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";
import { heartbeatHealth, safeTaskProgress, type TaskFailureFilter, type TaskFailureType } from "@/server/task-monitor-state";
import { serializeJobProgress } from "@/server/job-progress";

export type TaskFilter = "all" | "queued" | "running" | "failed" | "succeeded";

const ARTICLE_JOB_TYPES = ["generate_summary", "ingest_url", "refetch_article"];

function otherFailuresWhere(libraryId: string): Prisma.JobWhereInput {
  return { libraryId, status: "failed", type: { notIn: ARTICLE_JOB_TYPES } };
}

export async function getTaskMonitor(libraryId: string, filter: TaskFilter = "all", failureFilter: TaskFailureFilter = "all") {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const issues = await getArticleIssues(libraryId);
  const recent: Prisma.JobWhereInput = {
    libraryId,
    NOT: { status: "failed", type: { in: ARTICLE_JOB_TYPES } },
    OR: [{ status: { in: ["queued", "running"] } }, { finishedAt: { gte: since } }, { createdAt: { gte: since } }]
  };
  const [jobs, queued, running, succeeded, oldest, heartbeats, overdueSources, otherFailed, otherRetryable] = await Promise.all([
    prisma.job.findMany({
      where: filter === "failed"
        ? (failureFilter === "all" || failureFilter === "other" ? otherFailuresWhere(libraryId) : { libraryId, id: { in: [] } })
        : { ...recent, ...(filter === "all" ? {} : { status: filter }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, sourceId: true, type: true, status: true, attempts: true, maxAttempts: true,
        createdAt: true, startedAt: true, finishedAt: true, nextRunAt: true, lockedUntil: true,
        progressJson: true, payloadJson: true }
    }),
    prisma.job.count({ where: { libraryId, status: "queued" } }),
    prisma.job.count({ where: { libraryId, status: "running" } }),
    prisma.job.count({ where: { libraryId, status: "succeeded", finishedAt: { gte: since } } }),
    prisma.job.findFirst({ where: { libraryId, status: "queued" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.workerHeartbeat.findMany(),
    prisma.source.count({ where: { libraryId, type: "rss", status: { in: ["active", "error", "importing"] }, nextFetchAt: { lt: new Date(now.getTime() - 5 * 60_000) } } }),
    prisma.job.count({ where: otherFailuresWhere(libraryId) }),
    prisma.job.count({ where: { ...otherFailuresWhere(libraryId), type: { in: processableBackgroundJobTypes().filter(type => !ARTICLE_JOB_TYPES.includes(type)) } } })
  ]);
  const sourceIdFor = (job: typeof jobs[number]) => job.sourceId ?? (job.type === "fetch_source" ? fetchSourceIdFromPayload(job.payloadJson) : null);
  const sourceIds = jobs.map(sourceIdFor).filter((id): id is string => Boolean(id));
  const sources = await prisma.source.findMany({ where: { libraryId, id: { in: sourceIds } }, select: { id: true, name: true } });
  const names = new Map(sources.map(source => [source.id, source.name]));
  const failureCounts = {
    summary: issues.filter(issue => issue.kind === "summary").length,
    article_fetch: issues.filter(issue => issue.kind === "content").length,
    other: otherFailed
  };
  const retryableFailureCounts = {
    summary: issues.filter(issue => issue.kind === "summary" && issue.job && !issue.activeJobId).length,
    article_fetch: issues.filter(issue => issue.kind === "content" && issue.job && !issue.activeJobId).length,
    other: otherRetryable
  };
  const visibleIssues = issues.filter(issue => failureFilter === "all"
    || (failureFilter === "summary" ? issue.kind === "summary" : failureFilter === "article_fetch" && issue.kind === "content"));
  return {
    updatedAt: now.toISOString(),
    counts: { queued, running, succeeded, failed: issues.length + otherFailed }, overdueSources,
    failureCounts, retryableFailureCounts,
    articleIssues: visibleIssues.slice(0, 100).map(issue => ({ id: issue.id, title: issue.title, kind: issue.kind, jobId: issue.activeJobId ? null : issue.job?.id ?? null })),
    oldestQueuedAt: oldest?.createdAt.toISOString() ?? null,
    workers: (["scheduler", "newsletter"] as const).map(id => {
      const heartbeat = heartbeats.find(row => row.id === id);
      const disabled = id === "newsletter" && !newsletterInboundConfiguration().enabled;
      return { id, status: disabled ? "disabled" : heartbeatHealth(heartbeat?.lastSeenAt ?? null, heartbeat?.lastSuccessAt ?? null, now),
        lastSuccessAt: heartbeat?.lastSuccessAt?.toISOString() ?? null };
    }),
    jobs: jobs.map(job => ({
      id: job.id, type: job.type, status: job.status,
      sourceName: names.get(sourceIdFor(job) ?? "") ?? null,
      attempts: job.attempts, maxAttempts: job.maxAttempts,
      createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null, nextRunAt: job.nextRunAt?.toISOString() ?? null,
      recovering: job.status === "running" && Boolean(job.lockedUntil && job.lockedUntil <= now),
      canRetry: job.status === "failed" && isProcessableBackgroundJobType(job.type),
      ...safeTaskProgress(job.progressJson)
    }))
  };
}

export type TaskMonitorSnapshot = Awaited<ReturnType<typeof getTaskMonitor>>;

export async function retryMonitoredJob(libraryId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, libraryId } });
  if (!job) return "not_found";
  if (job.status !== "failed" || !isProcessableBackgroundJobType(job.type)) return "conflict";
  if (ARTICLE_JOB_TYPES.includes(job.type)) {
    const issues = await getArticleIssues(libraryId);
    if (!issues.some(issue => issue.job?.id === job.id && !issue.activeJobId)) return "conflict";
  }
  return requeueMonitoredJob(libraryId, job);
}

async function requeueMonitoredJob(libraryId: string, job: Job) {
  const jobId = job.id;
  const sourceId = job.type === "fetch_source" ? job.sourceId ?? fetchSourceIdFromPayload(job.payloadJson) : null;
  if (sourceId) {
    const source = await prisma.source.findFirst({ where: { id: sourceId, libraryId, type: "rss", status: { in: ["active", "error", "importing"] } } });
    if (!source || await activeSourceJob(sourceId, libraryId)) return "conflict";
  }
  try {
    const result = await prisma.job.updateMany({
      where: { id: jobId, libraryId, status: "failed" },
      data: { status: "queued", ...(sourceId ? { sourceId } : {}), attempts: 0,
        error: null, startedAt: null, finishedAt: null, nextRunAt: null, lockedUntil: null, leaseOwner: null,
        progressJson: serializeJobProgress({ stage: "queued" }) }
    });
    return result.count === 1 ? "queued" : "conflict";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "conflict";
    throw error;
  }
}

export async function retryMonitoredFailures(libraryId: string, failureType: TaskFailureType) {
  const candidates = failureType === "other"
    ? await prisma.job.findMany({ where: otherFailuresWhere(libraryId), orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    : (await getArticleIssues(libraryId))
      .filter(issue => issue.kind === (failureType === "summary" ? "summary" : "content"))
      .map(issue => issue.activeJobId ? null : issue.job);
  let queued = 0;
  const seen = new Set<string>();
  for (const job of candidates) {
    if (!job || seen.has(job.id) || !isProcessableBackgroundJobType(job.type)) continue;
    seen.add(job.id);
    if (await requeueMonitoredJob(libraryId, job) === "queued") queued += 1;
  }
  return { queued, skipped: candidates.length - queued, total: candidates.length };
}
