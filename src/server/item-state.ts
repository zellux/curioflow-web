export const SOURCE_TYPE = {
  PODCAST: "podcast",
  RSS: "rss"
} as const;

export const READ_STATUS = {
  DONE: "done",
  READING: "reading",
  UNREAD: "unread"
} as const;
export const READING_COMPLETION_THRESHOLD = 0.98;

export type ReadStatus = typeof READ_STATUS[keyof typeof READ_STATUS];

export type ItemListVisibilityMode = "archive" | "library" | "source-stream";

const READ_STATUS_VALUES = new Set<string>(Object.values(READ_STATUS));

export type ItemActionState = {
  archivedAt: Date | string | null;
  savedToLibrary: boolean;
  sourceId: string | null;
  source?: { type: string | null } | null;
  sourceEntries?: Array<{ sourceId: string; source?: { type: string | null } | null }>;
};

export type ItemActionEntryQuery = {
  filter?: string;
  source?: string;
};

export function isStreamSourceType(sourceType: string | null | undefined) {
  return sourceType === SOURCE_TYPE.RSS || sourceType === SOURCE_TYPE.PODCAST;
}

export function itemListVisibilityMode({
  activeSourceType,
  archived,
  sourceType
}: {
  activeSourceType?: string | null;
  archived?: boolean | null;
  sourceType?: string | null;
}): ItemListVisibilityMode {
  if (archived) return "archive";
  if (isStreamSourceType(activeSourceType) || isStreamSourceType(sourceType)) return "source-stream";
  return "library";
}

export function savedToLibraryFilterForVisibility(mode: ItemListVisibilityMode) {
  if (mode === "library") return true;
  if (mode === "source-stream") return false;
  return null;
}

export function normalizeReadStatus(value: string | null | undefined): ReadStatus | null {
  if (value === "read") return READ_STATUS.DONE;
  if (value && READ_STATUS_VALUES.has(value)) return value as ReadStatus;
  return null;
}

export function readStatusValidationMessage() {
  return "readStatus must be unread, reading, or done";
}

export function readStatusForProgress(progress: number): ReadStatus {
  if (progress <= 0) return READ_STATUS.UNREAD;
  if (progress >= READING_COMPLETION_THRESHOLD) return READ_STATUS.DONE;
  return READ_STATUS.READING;
}

export function isSourceStreamActionContext(item: ItemActionState, entryQuery: ItemActionEntryQuery) {
  if (entryQuery.source) {
    const occurrence = item.sourceEntries?.find((entry) => entry.sourceId === entryQuery.source);
    if (occurrence) return isStreamSourceType(occurrence.source?.type);
  }
  const hasStreamOccurrence = item.sourceEntries?.some((entry) => isStreamSourceType(entry.source?.type)) ?? false;
  if (entryQuery.filter === "recent-posts") return hasStreamOccurrence || isStreamSourceType(item.source?.type);
  return isStreamSourceType(item.source?.type) && Boolean(item.sourceId && entryQuery.source === item.sourceId);
}

export function itemShowsSaveAction(item: ItemActionState, entryQuery: ItemActionEntryQuery) {
  if (item.archivedAt) return false;
  return !item.savedToLibrary || isSourceStreamActionContext(item, entryQuery);
}

export function itemShowsArchiveAction(item: ItemActionState, entryQuery: ItemActionEntryQuery) {
  if (item.archivedAt) return true;
  const contextOccurrence = item.sourceEntries?.find((entry) => entry.sourceId === entryQuery.source);
  if (
    isSourceStreamActionContext(item, entryQuery)
    && (contextOccurrence?.source?.type === SOURCE_TYPE.RSS || item.source?.type === SOURCE_TYPE.RSS)
  ) return true;
  return item.savedToLibrary && !itemShowsSaveAction(item, entryQuery);
}
