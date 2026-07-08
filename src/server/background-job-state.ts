export const BACKGROUND_JOB_TYPES = {
  FETCH_SOURCE: "fetch_source",
  GENERATE_SUMMARY: "generate_summary",
  INGEST_URL: "ingest_url",
  REFETCH_ARTICLE: "refetch_article"
} as const;

export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[keyof typeof BACKGROUND_JOB_TYPES];
export type FetchSourceProcessor = "podcast" | "rss";

export const DEFAULT_JOB_MAX_ATTEMPTS = 3;

const PROCESSABLE_BACKGROUND_JOB_TYPES = [
  BACKGROUND_JOB_TYPES.INGEST_URL,
  BACKGROUND_JOB_TYPES.REFETCH_ARTICLE,
  BACKGROUND_JOB_TYPES.FETCH_SOURCE,
  BACKGROUND_JOB_TYPES.GENERATE_SUMMARY
] as const;

export function processableBackgroundJobTypes() {
  return [...PROCESSABLE_BACKGROUND_JOB_TYPES];
}

export function isProcessableBackgroundJobType(type: string | null | undefined): type is BackgroundJobType {
  return Boolean(type && PROCESSABLE_BACKGROUND_JOB_TYPES.includes(type as BackgroundJobType));
}

export function fetchSourceProcessorForPayload(payloadJson: string): FetchSourceProcessor {
  try {
    const payload = JSON.parse(payloadJson) as {
      episodes?: unknown;
      feedTitle?: unknown;
    };

    if (Array.isArray(payload.episodes) || typeof payload.feedTitle === "string") {
      return "podcast";
    }
  } catch {
    return "rss";
  }

  return "rss";
}

export function fetchSourceIdFromPayload(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as { sourceId?: unknown };
    return typeof payload.sourceId === "string" && payload.sourceId.trim() ? payload.sourceId : null;
  } catch {
    return null;
  }
}

export function isFailedRssFetchSourceJob(
  job: { payloadJson: string; status: string; type: string },
  rssSourceIds: Set<string> = new Set()
) {
  if (job.status !== "failed" || job.type !== BACKGROUND_JOB_TYPES.FETCH_SOURCE) return false;

  const sourceId = fetchSourceIdFromPayload(job.payloadJson);
  if (sourceId && rssSourceIds.has(sourceId)) return true;
  return fetchSourceProcessorForPayload(job.payloadJson) === "rss";
}

export function shouldRetryJob(attempts: number, maxAttempts = DEFAULT_JOB_MAX_ATTEMPTS) {
  return attempts < Math.max(1, maxAttempts);
}

export function jobRetryDelayMs(attempts: number) {
  const normalizedAttempts = Math.max(1, Math.floor(attempts));
  const minutes = Math.min(30, 2 ** (normalizedAttempts - 1));
  return minutes * 60 * 1000;
}
