import type { Account } from "@prisma/client";

const MB = 1024 * 1024;

export const DEFAULT_ENTITLEMENT_LIMITS = {
  maxOpmlFeedsPerImport: 100,
  maxOpmlUploadBytes: 5 * MB,
  maxPdfUploadBytes: 50 * MB,
  maxPodcastTranscriptionBytes: 25 * MB,
  maxSources: 500
} as const;

type EntitlementCode =
  | "source_limit"
  | "opml_limit"
  | "opml_size_limit"
  | "pdf_size_limit"
  | "podcast_transcription_disabled"
  | "podcast_transcription_size_limit"
  | "summary_generation_disabled"
  | "managed_usage_quota_exceeded";

export type EntitlementResult =
  | { allowed: true }
  | { allowed: false; code: EntitlementCode; reason: string };

type SourceLimitOptions = {
  requestedSources?: number;
};

export class EntitlementDeniedError extends Error {
  code: EntitlementCode;
  status = 403;

  constructor(result: Extract<EntitlementResult, { allowed: false }>) {
    super(result.reason);
    this.name = "EntitlementDeniedError";
    this.code = result.code;
  }
}

function positiveIntFromEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) return fallback;

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function requestedCount(value: number | undefined) {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export function maxSources() {
  return positiveIntFromEnv("CURIOFLOW_MAX_SOURCES", DEFAULT_ENTITLEMENT_LIMITS.maxSources);
}

export function maxPdfUploadBytes() {
  return positiveIntFromEnv("CURIOFLOW_MAX_PDF_UPLOAD_BYTES", DEFAULT_ENTITLEMENT_LIMITS.maxPdfUploadBytes);
}

export function maxOpmlFeedsPerImport() {
  return positiveIntFromEnv("CURIOFLOW_MAX_OPML_FEEDS", DEFAULT_ENTITLEMENT_LIMITS.maxOpmlFeedsPerImport);
}

export function maxOpmlUploadBytes() {
  return positiveIntFromEnv("CURIOFLOW_MAX_OPML_UPLOAD_BYTES", DEFAULT_ENTITLEMENT_LIMITS.maxOpmlUploadBytes);
}

export function canUploadOpmlForLimit(fileSize: number, uploadLimit = maxOpmlUploadBytes()): EntitlementResult {
  if (fileSize <= uploadLimit) return { allowed: true };
  return {
    allowed: false,
    code: "opml_size_limit",
    reason: `OPML uploads are limited to ${Math.floor(uploadLimit / MB)} MB.`
  };
}

export function maxPodcastTranscriptionBytes() {
  return positiveIntFromEnv("CURIOFLOW_MAX_PODCAST_TRANSCRIPTION_BYTES", DEFAULT_ENTITLEMENT_LIMITS.maxPodcastTranscriptionBytes);
}

function podcastTranscriptionEnabled() {
  return envFlag("CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION", true);
}

export function canAddSourceForCount(currentSources: number, options: SourceLimitOptions = {}, sourceLimit = maxSources()): EntitlementResult {
  const requestedSources = requestedCount(options.requestedSources);
  if (currentSources + requestedSources <= sourceLimit) return { allowed: true };

  return {
    allowed: false,
    code: "source_limit",
    reason: `Source limit reached. This workspace can have up to ${sourceLimit} active RSS or podcast sources.`
  };
}

export function canImportOpmlFeeds(account: Account, requestedFeeds: number): EntitlementResult {
  void account;
  const requestedFeedsCount = requestedCount(requestedFeeds);
  const importLimit = maxOpmlFeedsPerImport();
  if (requestedFeedsCount <= importLimit) return { allowed: true };

  return {
    allowed: false,
    code: "opml_limit",
    reason: `OPML imports are limited to ${importLimit} feeds at a time. Select fewer feeds and import the rest in another batch.`
  };
}

export function canUploadPdfForLimit(fileSize: number, uploadLimit = maxPdfUploadBytes()): EntitlementResult {
  if (fileSize <= uploadLimit) return { allowed: true };

  const limitMb = Math.floor(uploadLimit / MB);
  return {
    allowed: false,
    code: "pdf_size_limit",
    reason: `PDF uploads are limited to ${limitMb} MB.`
  };
}

export function canUploadPdf(account: Account, fileSize: number) {
  void account;
  return canUploadPdfForLimit(fileSize);
}

export function canTranscribePodcast(account: Account): EntitlementResult {
  void account;
  if (podcastTranscriptionEnabled()) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "podcast_transcription_disabled",
    reason: "Podcast transcription is disabled for this workspace."
  };
}

export function canTranscribePodcastAudioForLimit(fileSize: number, transcriptionLimit = maxPodcastTranscriptionBytes()): EntitlementResult {
  if (fileSize <= transcriptionLimit) return { allowed: true };

  const limitMb = Math.floor(transcriptionLimit / MB);
  return {
    allowed: false,
    code: "podcast_transcription_size_limit",
    reason: `Podcast audio transcription is limited to ${limitMb} MB.`
  };
}

export function canRunAsk(_account: Account) {
  void _account;
  return { allowed: true } satisfies EntitlementResult;
}

export function canGenerateBrief(_account: Account) {
  void _account;
  if (envFlag("CURIOFLOW_ENABLE_SUMMARY_GENERATION", true)) {
    return { allowed: true } satisfies EntitlementResult;
  }

  return {
    allowed: false,
    code: "summary_generation_disabled",
    reason: "Summary generation is disabled for this workspace."
  } satisfies EntitlementResult;
}

export function assertEntitlement(result: EntitlementResult) {
  if (!result.allowed) throw new EntitlementDeniedError(result);
}
