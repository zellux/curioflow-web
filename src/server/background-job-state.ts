export const BACKGROUND_JOB_TYPES = {
  FETCH_SOURCE: "fetch_source",
  GENERATE_SUMMARY: "generate_summary"
} as const;

export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[keyof typeof BACKGROUND_JOB_TYPES];
export type FetchSourceProcessor = "podcast" | "rss";

const PROCESSABLE_BACKGROUND_JOB_TYPES = [
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
