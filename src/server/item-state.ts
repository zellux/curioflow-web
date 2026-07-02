export const SOURCE_TYPE = {
  PODCAST: "podcast",
  RSS: "rss"
} as const;

export const READ_STATUS = {
  DONE: "done",
  READING: "reading",
  UNREAD: "unread"
} as const;

export type ReadStatus = typeof READ_STATUS[keyof typeof READ_STATUS];

export type ItemListVisibilityMode = "archive" | "library" | "source-stream";

const READ_STATUS_VALUES = new Set<string>(Object.values(READ_STATUS));

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
