import { Prisma } from "@prisma/client";
import { AuthRequiredError, getAuthenticatedUser, manualUrlSourceId } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  isMobileDeleteRequest,
  mobileUpdateBaseUpdatedAt,
  mobileUpdateClientMutationId,
  mobileUpdateItemId,
  mobileUpdateProgressMode,
  normalizeMobileItemUpdate,
  type MobileItemUpdate
} from "@/server/mobile-sync-state";
import { createArticleHtmlRenderer } from "@/server/reader/rendering";
import { getLlmSettingsForAccount } from "@/server/settings";
import { readLlmSummaryFromMetadata } from "@/server/summary-metadata";
import { readStatusForProgress } from "@/server/item-state";
import { documentVisibleToAccount } from "@/server/document-ownership";
import { compareItemsByRecentActivity } from "@/server/item-order";

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 250;
const READING_THEMES = new Set(["broadsheet", "journal", "quiet"]);
const READING_FONTS = new Set(["serif", "sans", "brush"]);
const COLOR_MODES = new Set(["bright", "dark"]);
const DEFAULT_READING_SETTINGS = {
  theme: "broadsheet",
  font: "serif",
  colorMode: "bright",
  fontScale: 1
};

type MobileSyncScope = "all" | "library" | "feeds" | "archive";

type MobileReadingSettingsUpdate = {
  theme?: string;
  font?: string;
  colorMode?: string;
  fontScale?: number;
};

type MobilePushResult = {
  itemId: string | null;
  clientMutationId: string | null;
  ok: boolean;
  conflict?: boolean;
  serverUpdatedAt?: string | null;
  error?: string;
};

export type MobileAnnotationMutation = {
  annotationId?: unknown;
  clientMutationId?: unknown;
  color?: unknown;
  itemId?: unknown;
  location?: unknown;
  note?: unknown;
  operation?: unknown;
  quote?: unknown;
};

const MOBILE_MUTATION_RECEIPT_RETENTION_DAYS = 30;

function normalizeReadingTheme(value: string | null | undefined) {
  return value && READING_THEMES.has(value) ? value : DEFAULT_READING_SETTINGS.theme;
}

function legacyThemeForFont(value: string | null | undefined) {
  if (value === "sans") return "journal";
  if (value === "brush") return "quiet";
  return "broadsheet";
}

function fontForLegacyTheme(value: string | null | undefined) {
  if (value === "journal") return "sans";
  if (value === "quiet") return "brush";
  return "serif";
}

function normalizeReadingFont(value: string | null | undefined, legacyTheme?: string | null) {
  if (value && READING_FONTS.has(value)) return value;
  return fontForLegacyTheme(legacyTheme);
}

function normalizeColorMode(value: string | null | undefined) {
  return value && COLOR_MODES.has(value) ? value : DEFAULT_READING_SETTINGS.colorMode;
}

function normalizeFontScale(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_READING_SETTINGS.fontScale;
  return Math.max(0.85, Math.min(1.35, value));
}

function normalizeScope(value: string | null | undefined): MobileSyncScope {
  return value === "library" || value === "feeds" || value === "archive" ? value : "all";
}

function normalizeLimit(value: string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_LIMIT;
  return Math.max(1, Math.min(MAX_SYNC_LIMIT, Math.floor(parsed)));
}

function itemWhereForScope(libraryId: string, scope: MobileSyncScope) {
  if (scope === "library") {
    return { libraryId, savedToLibrary: true, archivedAt: null, deletedAt: null };
  }

  if (scope === "feeds") {
    return {
      libraryId,
      savedToLibrary: false,
      archivedAt: null,
      deletedAt: null,
      sourceEntries: {
        some: { source: { type: { in: ["rss", "podcast"] }, status: { not: "unsubscribed" } } }
      }
    };
  }

  if (scope === "archive") {
    return { libraryId, archivedAt: { not: null }, deletedAt: null };
  }

  return { libraryId, archivedAt: null, deletedAt: null };
}

function safeJsonObject(value: string | null | undefined) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mobileDocumentMetadata(value: string | null | undefined, llmEnabled: boolean) {
  const metadata = safeJsonObject(value) as Record<string, unknown>;
  if (llmEnabled) return metadata;

  const visibleMetadata = { ...metadata };
  for (const key of [
    "summary",
    "summaryAccountId",
    "summaryError",
    "summaryFailedAt",
    "summaryGeneratedAt",
    "summaryLanguage",
    "summaryModel",
    "summaryProvider",
    "summaryRequestedAt",
    "summarySource",
    "summaryStatus"
  ]) {
    delete visibleMetadata[key];
  }
  return visibleMetadata;
}

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseRevision(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function getReadingSettingsForAccount(accountId: string) {
  const preference = await prisma.readingPreference.findUnique({
    where: { accountId }
  });

  const font = normalizeReadingFont(preference?.font, preference?.theme);

  return {
    theme: legacyThemeForFont(font),
    font,
    colorMode: normalizeColorMode(preference?.colorMode),
    fontScale: normalizeFontScale(preference?.fontScale)
  };
}

async function upsertReadingSettingsForAccount(accountId: string, update: MobileReadingSettingsUpdate) {
  const font = (update.font || update.theme) ? normalizeReadingFont(update.font, update.theme) : undefined;
  const colorMode = update.colorMode ? normalizeColorMode(update.colorMode) : undefined;
  const theme = update.theme ? normalizeReadingTheme(update.theme) : font ? legacyThemeForFont(font) : undefined;
  const fontScale = typeof update.fontScale === "number" ? normalizeFontScale(update.fontScale) : undefined;

  if (!theme && !font && !colorMode && fontScale === undefined) {
    return getReadingSettingsForAccount(accountId);
  }

  const existing = await getReadingSettingsForAccount(accountId);

  const preference = await prisma.readingPreference.upsert({
    where: { accountId },
    update: {
      ...(theme ? { theme } : {}),
      ...(font ? { font } : {}),
      ...(colorMode ? { colorMode } : {}),
      ...(fontScale !== undefined ? { fontScale } : {})
    },
    create: {
      accountId,
      theme: theme ?? existing.theme,
      font: font ?? existing.font,
      colorMode: colorMode ?? existing.colorMode,
      fontScale: fontScale ?? existing.fontScale
    }
  });

  const normalizedFont = normalizeReadingFont(preference.font, preference.theme);

  return {
    theme: legacyThemeForFont(normalizedFont),
    font: normalizedFont,
    colorMode: normalizeColorMode(preference.colorMode),
    fontScale: normalizeFontScale(preference.fontScale)
  };
}

export async function getMobileContext() {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new AuthRequiredError();
  }
  const account = await prisma.account.findUniqueOrThrow({ where: { id: user.accountId } });

  let library = await prisma.library.findFirst({
    where: { accountId: user.accountId },
    orderBy: { createdAt: "asc" }
  });

  if (!library) {
    library = await prisma.library.create({
      data: {
        accountId: user.accountId,
        name: "Personal Library"
      }
    });
  }

  await prisma.source.upsert({
    where: { id: manualUrlSourceId(library.id) },
    update: {},
    create: {
      id: manualUrlSourceId(library.id),
      libraryId: library.id,
      type: "url",
      name: "Saved URLs"
    }
  });

  return { user, account, library };
}

export async function getMobileSyncPayload(requestUrl: string) {
  const url = new URL(requestUrl);
  const scope = normalizeScope(url.searchParams.get("scope"));
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const cursor = parseRevision(url.searchParams.get("cursor"));
  const requestedPageCursor = parseRevision(url.searchParams.get("pageCursor"));
  const requestedWatermark = parseRevision(url.searchParams.get("watermark"));
  const { user, library } = await getMobileContext();
  const watermarkResult = await prisma.libraryChange.aggregate({
    where: { libraryId: library.id },
    _max: { revision: true }
  });
  const currentWatermark = watermarkResult._max.revision ?? BigInt(0);
  const watermark = requestedWatermark === null
    ? currentWatermark
    : requestedWatermark > currentWatermark
      ? currentWatermark
      : requestedWatermark;
  const itemInclude = {
    source: true,
    sourceEntries: {
      where: { source: { status: { not: "unsubscribed" } } },
      include: { source: true }
    },
    document: true,
    annotations: {
      where: { userId: user.id },
      orderBy: { createdAt: "desc" as const }
    }
  } as const;

  const [readingSettings, llmSettings, sources] = await Promise.all([
    getReadingSettingsForAccount(user.accountId),
    getLlmSettingsForAccount(user.accountId),
    prisma.source.findMany({
      where: {
        libraryId: library.id,
        status: { not: "unsubscribed" }
      },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }]
    })
  ]);

  let items: Prisma.ItemGetPayload<{ include: typeof itemInclude }>[] = [];
  let tombstones: Array<{ itemId: string; deletedAt: Date; updatedAt: Date }> = [];
  let hasMore = false;
  let nextPageCursor: string | null = null;

  if (cursor !== null) {
    const pageCursor = requestedPageCursor === null || requestedPageCursor < cursor
      ? cursor
      : requestedPageCursor > watermark
        ? watermark
        : requestedPageCursor;
    const changes = await prisma.libraryChange.findMany({
      where: {
        libraryId: library.id,
        revision: { gt: pageCursor, lte: watermark }
      },
      orderBy: { revision: "asc" },
      take: limit + 1
    });
    hasMore = changes.length > limit;
    const deliveredChanges = changes.slice(0, limit);
    nextPageCursor = hasMore
      ? deliveredChanges.at(-1)?.revision.toString() ?? pageCursor.toString()
      : null;
    const changedItemIds = [...new Set(
      deliveredChanges.filter((change) => change.entityType === "item").map((change) => change.entityId)
    )];
    items = await prisma.item.findMany({
      where: { id: { in: changedItemIds }, libraryId: library.id, deletedAt: null },
      include: itemInclude
    });
    const existingItemIds = new Set(items.map((item) => item.id));
    const latestMissingChanges = new Map<string, (typeof deliveredChanges)[number]>();
    for (const change of deliveredChanges) {
      if (change.entityType === "item" && !existingItemIds.has(change.entityId)) {
        latestMissingChanges.set(change.entityId, change);
      }
    }
    tombstones = [...latestMissingChanges.values()].map((change) => ({
      itemId: change.entityId,
      deletedAt: change.createdAt,
      updatedAt: change.createdAt
    }));
  } else {
    const scopes: MobileSyncScope[] = scope === "all" ? ["library", "feeds", "archive"] : [scope];
    const scopedItems = await Promise.all(scopes.map(async (snapshotScope) => {
      const where = itemWhereForScope(library.id, snapshotScope);
      const orderedItems = await prisma.item.findMany({
        where,
        select: { id: true, createdAt: true, lastReadAt: true }
      });
      const itemIds = orderedItems
        .sort(compareItemsByRecentActivity)
        .slice(0, limit)
        .map((item) => item.id);
      const unorderedItems = await prisma.item.findMany({
        where: { ...where, id: { in: itemIds } },
        include: itemInclude
      });
      const itemsById = new Map(unorderedItems.map((item) => [item.id, item]));
      return itemIds.flatMap((id) => {
        const item = itemsById.get(id);
        return item ? [item] : [];
      });
    }));
    const seenItemIds = new Set<string>();
    items = scopedItems.flat().filter((item) => {
      if (seenItemIds.has(item.id)) return false;
      seenItemIds.add(item.id);
      return true;
    });
  }

  const serverTime = new Date().toISOString();
  const serializedItems = (() => {
    const articleRenderer = createArticleHtmlRenderer();
    try {
      return items.map((item) => {
    const document = documentVisibleToAccount(item.document, user.accountId) ? item.document : null;
    const preparedArticle = articleRenderer.render(
      document?.articleHtml,
      document?.text,
      item.id
    );

    const documentMetadata = document?.metadataJson;
    const summary = llmSettings.enabled
      ? readLlmSummaryFromMetadata(documentMetadata, user.accountId)
      : null;
    const metadata = mobileDocumentMetadata(documentMetadata, llmSettings.enabled);
    const primarySource = item.sourceEntries[0]?.source ?? item.source;

    return {
      id: item.id,
      sourceId: primarySource?.id ?? null,
      sourceIds: item.sourceEntries.map((entry) => entry.sourceId),
      sourceName: primarySource?.name ?? null,
      sourceType: primarySource?.type ?? null,
      type: item.type,
      title: item.title,
      url: item.url,
      author: item.author,
      publishedAt: serializeDate(item.publishedAt),
      status: item.status,
      readStatus: item.readStatus,
      savedToLibrary: item.savedToLibrary,
      readingProgress: item.readingProgress,
      readingPosition: safeJsonObject(item.readingPositionJson),
      lastReadAt: serializeDate(item.lastReadAt),
      archivedAt: serializeDate(item.archivedAt),
      createdAt: serializeDate(item.createdAt),
      updatedAt: serializeDate(item.updatedAt),
      document: document
        ? {
            id: document.id,
            contentType: document.contentType,
            title: document.title,
            html: preparedArticle.html,
            text: document.text,
            summary,
            tocItems: preparedArticle.tocItems,
            language: document.language,
            metadata,
            createdAt: serializeDate(document.createdAt)
          }
        : null,
      annotations: item.annotations.map((annotation) => ({
        id: annotation.id,
        quote: annotation.quote,
        note: annotation.note,
        location: safeJsonObject(annotation.locationJson),
        createdAt: serializeDate(annotation.createdAt)
      }))
        };
      });
    } finally {
      articleRenderer.close();
    }
  })();

  return {
    serverTime,
    syncCursor: watermark.toString(),
    syncMode: cursor !== null ? "delta" : "snapshot",
    watermark: watermark.toString(),
    hasMore,
    nextPageCursor,
    user: {
      id: user.id,
      displayName: user.displayName
    },
    library: {
      id: library.id,
      name: library.name
    },
    settings: {
      reading: readingSettings,
      llm: llmSettings
    },
    sources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      url: source.url,
      category: source.category,
      status: source.status,
      lastCheckedAt: serializeDate(source.lastCheckedAt),
      createdAt: serializeDate(source.createdAt)
    })),
    items: serializedItems,
    tombstones: tombstones.map((item) => ({
      itemId: item.itemId,
      deletedAt: serializeDate(item.deletedAt),
      updatedAt: serializeDate(item.updatedAt)
    }))
  };
}

export async function applyMobileSyncUpdates({
  annotationMutations,
  deviceId,
  itemUpdates,
  readingSettings
}: {
  annotationMutations?: MobileAnnotationMutation[];
  deviceId?: unknown;
  itemUpdates?: MobileItemUpdate[];
  readingSettings?: MobileReadingSettingsUpdate;
}) {
  const { user, library } = await getMobileContext();
  const results: MobilePushResult[] = [];
  const normalizedDeviceId = normalizeMobileDeviceId(deviceId);

  if (readingSettings) {
    await upsertReadingSettingsForAccount(user.accountId, readingSettings);
  }

  await prisma.mobileMutationReceipt.deleteMany({
    where: {
      createdAt: {
        lt: new Date(Date.now() - MOBILE_MUTATION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      }
    }
  });

  for (const update of itemUpdates ?? []) {
    results.push(await applyMobileItemUpdate({
      deviceId: normalizedDeviceId,
      libraryId: library.id,
      update
    }));
  }
  for (const mutation of annotationMutations ?? []) {
    results.push(await applyMobileAnnotationMutation({
      deviceId: normalizedDeviceId,
      libraryId: library.id,
      userId: user.id,
      mutation
    }));
  }

  return {
    serverTime: new Date().toISOString(),
    settings: {
      reading: await getReadingSettingsForAccount(user.accountId)
    },
    results
  };
}

function mobileString(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function applyMobileAnnotationMutation({
  deviceId,
  libraryId,
  userId,
  mutation
}: {
  deviceId: string | null;
  libraryId: string;
  userId: string;
  mutation: MobileAnnotationMutation;
}): Promise<MobilePushResult> {
  const itemId = mobileString(mutation.itemId, 200);
  const annotationId = mobileString(mutation.annotationId, 200);
  const clientMutationId = mobileString(mutation.clientMutationId, 200) || null;
  const receiptKey = deviceId && clientMutationId ? { libraryId, deviceId, clientMutationId } : null;

  try {
    return await prisma.$transaction(async (tx) => {
      if (receiptKey) {
        const receipt = await tx.mobileMutationReceipt.findUnique({
          where: { libraryId_deviceId_clientMutationId: receiptKey },
          select: { responseJson: true }
        });
        if (receipt) return parseStoredMobileResult(receipt.responseJson);
      }

      let result: MobilePushResult;
      if (!itemId || !annotationId) {
        result = { itemId: itemId || null, clientMutationId, ok: false, error: "itemId and annotationId are required" };
      } else {
        const item = await tx.item.findFirst({
          where: { id: itemId, libraryId, deletedAt: null },
          select: { id: true, documentId: true }
        });
        if (!item?.documentId) {
          result = { itemId, clientMutationId, ok: false, error: "Item not found or not indexed" };
        } else if (mutation.operation === "create") {
          const quote = mobileString(mutation.quote);
          if (!quote) {
            result = { itemId, clientMutationId, ok: false, error: "quote is required" };
          } else {
            const existing = await tx.annotation.findUnique({
              where: { id: annotationId },
              select: { itemId: true, userId: true }
            });
            if (existing && (existing.itemId !== itemId || existing.userId !== userId)) {
              result = { itemId, clientMutationId, ok: false, error: "Annotation id is unavailable" };
            } else {
              if (!existing) {
                const location = mutation.location && typeof mutation.location === "object" && !Array.isArray(mutation.location)
                  ? mutation.location
                  : {};
                await tx.annotation.create({
                  data: {
                    id: annotationId,
                    userId,
                    itemId,
                    documentId: item.documentId,
                    quote,
                    note: mobileString(mutation.note) || null,
                    locationJson: JSON.stringify({
                      type: "highlight",
                      color: mobileString(mutation.color, 100) || "#F3D27A",
                      ...location
                    })
                  }
                });
              }
              result = { itemId, clientMutationId, ok: true };
            }
          }
        } else if (mutation.operation === "update") {
          const updated = await tx.annotation.updateMany({
            where: { id: annotationId, itemId, userId },
            data: { note: mobileString(mutation.note) || null }
          });
          result = updated.count === 1
            ? { itemId, clientMutationId, ok: true }
            : { itemId, clientMutationId, ok: false, error: "Annotation not found" };
        } else if (mutation.operation === "delete") {
          await tx.annotation.deleteMany({ where: { id: annotationId, itemId, userId } });
          result = { itemId, clientMutationId, ok: true };
        } else {
          result = { itemId, clientMutationId, ok: false, error: "Unsupported annotation operation" };
        }
      }

      if (receiptKey) {
        await tx.mobileMutationReceipt.create({
          data: { ...receiptKey, itemId: itemId || null, responseJson: JSON.stringify(result) }
        });
      }
      return result;
    });
  } catch (error) {
    if (!receiptKey || !isUniqueConstraintError(error)) throw error;
    const receipt = await prisma.mobileMutationReceipt.findUnique({
      where: { libraryId_deviceId_clientMutationId: receiptKey },
      select: { responseJson: true }
    });
    if (!receipt) throw error;
    return parseStoredMobileResult(receipt.responseJson);
  }
}

function normalizeMobileDeviceId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseStoredMobileResult(responseJson: string): MobilePushResult {
  return JSON.parse(responseJson) as MobilePushResult;
}

async function applyMobileItemUpdate({
  deviceId,
  libraryId,
  update
}: {
  deviceId: string | null;
  libraryId: string;
  update: MobileItemUpdate;
}) {
  const itemId = mobileUpdateItemId(update);
  const clientMutationId = mobileUpdateClientMutationId(update);
  const receiptKey = deviceId && clientMutationId
    ? { libraryId, deviceId, clientMutationId }
    : null;

  try {
    return await prisma.$transaction(async (tx) => {
      if (receiptKey) {
        const receipt = await tx.mobileMutationReceipt.findUnique({
          where: { libraryId_deviceId_clientMutationId: receiptKey },
          select: { responseJson: true }
        });
        if (receipt) return parseStoredMobileResult(receipt.responseJson);
      }

      const result = await applyMobileItemUpdateOnce(tx, update, itemId, clientMutationId, libraryId);
      if (receiptKey) {
        await tx.mobileMutationReceipt.create({
          data: {
            ...receiptKey,
            itemId: itemId || null,
            responseJson: JSON.stringify(result)
          }
        });
      }
      return result;
    });
  } catch (error) {
    if (!receiptKey || !isUniqueConstraintError(error)) throw error;
    const receipt = await prisma.mobileMutationReceipt.findUnique({
      where: { libraryId_deviceId_clientMutationId: receiptKey },
      select: { responseJson: true }
    });
    if (!receipt) throw error;
    return parseStoredMobileResult(receipt.responseJson);
  }
}

async function applyMobileItemUpdateOnce(
  tx: Prisma.TransactionClient,
  update: MobileItemUpdate,
  itemId: string,
  clientMutationId: string | null,
  libraryId: string
): Promise<MobilePushResult> {
  if (!itemId) {
    return { itemId: null, clientMutationId, ok: false, error: "itemId is required" };
  }

  if (isMobileDeleteRequest(update)) {
    const item = await tx.item.findFirst({
      where: { id: itemId, libraryId },
      select: { id: true, deletedAt: true }
    });
    if (!item) return { itemId, clientMutationId, ok: true };

    const deleted = await tx.item.update({
      where: { id: item.id },
      data: { deletedAt: item.deletedAt ?? new Date() },
      select: { updatedAt: true }
    });
    return { itemId, clientMutationId, ok: true, serverUpdatedAt: serializeDate(deleted.updatedAt) };
  }

  const normalizedUpdate = normalizeMobileItemUpdate(update);
  if (!normalizedUpdate.ok) {
    return { itemId, clientMutationId, ok: false, error: normalizedUpdate.error };
  }
  if (Object.keys(normalizedUpdate.data).length === 0) {
    return { itemId, clientMutationId, ok: false, error: "No supported fields to sync" };
  }

  const existing = await tx.item.findFirst({
    where: { id: itemId, libraryId, deletedAt: null },
    select: { id: true, readingProgress: true, updatedAt: true }
  });
  if (!existing) {
    return { itemId, clientMutationId, ok: false, error: "Item not found" };
  }

  const baseUpdatedAt = mobileUpdateBaseUpdatedAt(update);
  const hasConflict = Boolean(baseUpdatedAt && existing.updatedAt > baseUpdatedAt);
  const data = {
    ...normalizedUpdate.data,
    ...(normalizedUpdate.data.readingProgress !== undefined
      ? (() => {
          const readingProgress = mobileUpdateProgressMode(update) === "advance"
            ? Math.max(existing.readingProgress, normalizedUpdate.data.readingProgress)
            : normalizedUpdate.data.readingProgress;
          return { readingProgress, readStatus: readStatusForProgress(readingProgress) };
        })()
      : {})
  };
  const saved = await tx.item.update({
    where: { id: existing.id },
    data,
    select: { updatedAt: true }
  });
  return {
    itemId,
    clientMutationId,
    ok: true,
    conflict: hasConflict,
    serverUpdatedAt: serializeDate(saved.updatedAt)
  };
}
