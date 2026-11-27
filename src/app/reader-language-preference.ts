export const READER_LANGUAGE_STORAGE_KEY = "curioflow-reader-language-preference";
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
  return next;
}
