export const READER_LANGUAGE_STORAGE_KEY = "curioflow-reader-language-preference";
export const READER_LANGUAGE_CHANGE_EVENT = "curioflow:reader-language-change";
export const MAX_REMEMBERED_ITEMS = 500;

export type ReaderLanguagePreferenceState = {
  lastLanguage: string | null;
  byItem: Record<string, string>;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageReadWriter = Pick<Storage, "getItem" | "setItem">;

const EMPTY_PREFERENCE: ReaderLanguagePreferenceState = {
  lastLanguage: null,
  byItem: {}
};

function normalizeLanguageChoice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

export function parseReaderLanguagePreference(
  raw: string | null,
  maxItems = MAX_REMEMBERED_ITEMS
): ReaderLanguagePreferenceState {
  if (!raw) return { lastLanguage: null, byItem: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { lastLanguage: null, byItem: {} };
    }
    const record = parsed as { lastLanguage?: unknown; byItem?: unknown };
    const lastLanguage = normalizeLanguageChoice(record.lastLanguage);
    const byItem: Record<string, string> = {};
    if (record.byItem && typeof record.byItem === "object" && !Array.isArray(record.byItem)) {
      const entries = Object.entries(record.byItem as Record<string, unknown>)
        .map(([itemId, language]) => [itemId.trim(), normalizeLanguageChoice(language)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0]) && entry[1] !== null);
      const bounded = entries.slice(-Math.max(0, maxItems));
      for (const [itemId, language] of bounded) {
        byItem[itemId] = language;
      }
    }
    return { lastLanguage, byItem };
  } catch {
    return { lastLanguage: null, byItem: {} };
  }
}

export function rememberReaderLanguageInState(
  state: ReaderLanguagePreferenceState,
  itemId: string,
  language: string,
  maxItems = MAX_REMEMBERED_ITEMS
): ReaderLanguagePreferenceState {
  const normalizedLanguage = normalizeLanguageChoice(language);
  const normalizedItemId = itemId.trim();
  if (!normalizedLanguage) return state;

  const entries = Object.entries(state.byItem).filter(([key]) => key !== normalizedItemId);
  if (normalizedItemId) {
    entries.push([normalizedItemId, normalizedLanguage]);
  }
  const bounded = entries.slice(-Math.max(0, maxItems));
  const byItem: Record<string, string> = {};
  for (const [key, value] of bounded) {
    byItem[key] = value;
  }

  return {
    lastLanguage: normalizedLanguage,
    byItem
  };
}

export function preferredReaderLanguage(
  state: ReaderLanguagePreferenceState,
  itemId: string
): string | null {
  const normalizedItemId = itemId.trim();
  if (normalizedItemId && Object.hasOwn(state.byItem, normalizedItemId)) {
    return state.byItem[normalizedItemId];
  }
  return state.lastLanguage;
}

export function resolveInitialReaderLanguage(
  preferred: string | null,
  readyLanguages: readonly string[]
): string {
  if (!preferred || preferred === "original") return "original";
  return readyLanguages.includes(preferred) ? preferred : "original";
}

function canonicalLanguageTag(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (normalized === "zh-cn" || normalized === "zh-sg" || normalized === "zh-hans" || normalized.startsWith("zh-hans-")) {
    return "zh-hans";
  }
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized === "zh-hant" || normalized.startsWith("zh-hant-")) {
    return "zh-hant";
  }
  return normalized;
}

export function isSameLanguageTag(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = canonicalLanguageTag(a);
  const right = canonicalLanguageTag(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftPrimary = left.split("-")[0];
  const rightPrimary = right.split("-")[0];
  if (leftPrimary === "zh" || rightPrimary === "zh") return false;
  return Boolean(leftPrimary) && leftPrimary === rightPrimary;
}

export function resolveListLanguageBadge(
  state: ReaderLanguagePreferenceState,
  itemId: string,
  readyLanguages: readonly string[],
  originalLanguage?: string | null
): string | null {
  if (readyLanguages.length === 0) return null;
  const preferred = preferredReaderLanguage(state, itemId);
  const resolved = resolveInitialReaderLanguage(preferred, readyLanguages);
  if (resolved === "original") return null;
  if (originalLanguage && isSameLanguageTag(resolved, originalLanguage)) return null;
  return resolved;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readReaderLanguagePreference(
  storage?: StorageReader | null
): ReaderLanguagePreferenceState {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    if (!target) return { ...EMPTY_PREFERENCE, byItem: {} };
    return parseReaderLanguagePreference(target.getItem(READER_LANGUAGE_STORAGE_KEY));
  } catch {
    return { ...EMPTY_PREFERENCE, byItem: {} };
  }
}

export function saveReaderLanguagePreference(
  itemId: string,
  language: string,
  storage?: StorageReadWriter | null
): ReaderLanguagePreferenceState {
  const target = storage === undefined ? defaultStorage() : storage;
  const current = readReaderLanguagePreference(target);
  const next = rememberReaderLanguageInState(current, itemId, language);
  try {
    target?.setItem(READER_LANGUAGE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable or full; keep reading state working in memory.
  }
  if (storage === undefined && typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(READER_LANGUAGE_CHANGE_EVENT));
    } catch {
      // Ignore event dispatch failures in restricted environments.
    }
  }
  return next;
}
