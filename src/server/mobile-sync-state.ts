import { normalizeReadStatus, readStatusValidationMessage, type ReadStatus } from "./item-state.ts";

export const MAX_MOBILE_MUTATIONS_PER_REQUEST = 100;

export type MobileItemUpdate = {
  archived?: unknown;
  baseUpdatedAt?: unknown;
  clientMutationId?: unknown;
  deleted?: unknown;
  itemId?: unknown;
  progressMode?: unknown;
  readingPosition?: unknown;
  readingProgress?: unknown;
  readStatus?: unknown;
  savedToLibrary?: unknown;
  starred?: unknown;
};

export type MobileItemUpdateData = {
  archivedAt?: Date | null;
  lastReadAt?: Date;
  readingPositionJson?: string;
  readingProgress?: number;
  readStatus?: ReadStatus;
  savedToLibrary?: boolean;
  starred?: boolean;
};

type MobileItemUpdateNormalization =
  | { ok: true; data: MobileItemUpdateData }
  | { ok: false; error: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasField(update: MobileItemUpdate, field: keyof MobileItemUpdate) {
  return Object.prototype.hasOwnProperty.call(update, field);
}

export function mobileUpdateItemId(update: MobileItemUpdate) {
  return typeof update.itemId === "string" ? update.itemId.trim() : "";
}

export function isMobileDeleteRequest(update: MobileItemUpdate) {
  return update.deleted === true;
}

export function mobileUpdateBaseUpdatedAt(update: MobileItemUpdate) {
  if (typeof update.baseUpdatedAt !== "string") return null;
  const parsed = new Date(update.baseUpdatedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function mobileUpdateClientMutationId(update: MobileItemUpdate) {
  return typeof update.clientMutationId === "string" ? update.clientMutationId.trim() : null;
}

export function mobileUpdateProgressMode(update: MobileItemUpdate) {
  return update.progressMode === "advance" ? "advance" : "set";
}

export function mobileMutationBatchValidationError(updates: MobileItemUpdate[]) {
  if (updates.length > MAX_MOBILE_MUTATIONS_PER_REQUEST) {
    return `itemUpdates must contain at most ${MAX_MOBILE_MUTATIONS_PER_REQUEST} entries`;
  }

  return null;
}

export function normalizeMobileItemUpdate(update: MobileItemUpdate, now = new Date()): MobileItemUpdateNormalization {
  const data: MobileItemUpdateData = {};

  if (hasField(update, "readingProgress")) {
    if (typeof update.readingProgress !== "number" || !Number.isFinite(update.readingProgress)) {
      return { ok: false, error: "readingProgress must be a finite number" };
    }

    data.readingProgress = Math.max(0, Math.min(1, update.readingProgress));
    data.lastReadAt = now;
  }

  if (hasField(update, "readingPosition")) {
    if (!isPlainRecord(update.readingPosition)) {
      return { ok: false, error: "readingPosition must be an object" };
    }

    data.readingPositionJson = JSON.stringify(update.readingPosition);
  }

  if (hasField(update, "readStatus")) {
    const readStatus = typeof update.readStatus === "string" ? normalizeReadStatus(update.readStatus) : null;
    if (!readStatus) {
      return { ok: false, error: readStatusValidationMessage() };
    }

    data.readStatus = readStatus;
  }

  if (hasField(update, "savedToLibrary")) {
    if (typeof update.savedToLibrary !== "boolean") {
      return { ok: false, error: "savedToLibrary must be a boolean" };
    }

    data.savedToLibrary = update.savedToLibrary;
  }

  if (hasField(update, "starred")) {
    if (typeof update.starred !== "boolean") {
      return { ok: false, error: "starred must be a boolean" };
    }

    data.starred = update.starred;
  }

  if (hasField(update, "archived")) {
    if (typeof update.archived !== "boolean") {
      return { ok: false, error: "archived must be a boolean" };
    }

    data.archivedAt = update.archived ? now : null;
  }

  return { ok: true, data };
}

type LibraryMembership = Pick<MobileItemUpdateData, "archivedAt" | "savedToLibrary">;

export function resolveMobileLibraryUpdate(
  update: LibraryMembership,
  existing: { archivedAt: Date | null; savedToLibrary: boolean },
  hasActiveSubscription: boolean
): LibraryMembership {
  const inLibrary = existing.savedToLibrary || existing.archivedAt !== null;
  if (update.archivedAt) {
    if (!inLibrary && update.savedToLibrary !== true) return {};
    return { archivedAt: existing.archivedAt ?? update.archivedAt, savedToLibrary: true };
  }
  if (update.savedToLibrary === false) {
    return hasActiveSubscription ? { archivedAt: null, savedToLibrary: false } : {};
  }
  if ((update.archivedAt === null && inLibrary) || (update.savedToLibrary === true && !inLibrary)) {
    return { archivedAt: null, savedToLibrary: true };
  }
  return {};
}
