import { prisma } from "@/server/db";
import { normalizeUrl, saveArticleItemToLibrary } from "@/server/ingest/articles";
import { manualUrlSourceId } from "@/server/auth";
import type { ReadwiseArticle } from "@/lib/readwise-csv";

export function validateReadwiseArticles(input: unknown): ReadwiseArticle[] {
  if (!Array.isArray(input) || !input.length || input.length > 50) throw new Error("Send 1–50 articles per batch.");
  return input.map(row => {
    if (!row || typeof row.title !== "string" || row.title.length > 10000 || typeof row.url !== "string" || row.url.length > 16000 ||
      typeof row.archived !== "boolean" || typeof row.progress !== "number" || !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1 ||
      (row.savedAt !== null && (typeof row.savedAt !== "string" || !Number.isFinite(Date.parse(row.savedAt))))) throw new Error("Invalid article data.");
    return { title: row.title, url: row.url, savedAt: row.savedAt, archived: row.archived, progress: row.progress };
  });
}

function canonical(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Expected an HTTP(S) URL without credentials.");
  return normalizeUrl(raw);
}

export async function importReadwiseArticles(libraryId: string, input: ReadwiseArticle[], apply = true) {
  const rows = validateReadwiseArticles(input);
  await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, select: { id: true } });
  const result = { imported: 0, existing: 0, invalid: 0, missing: 0, failed: 0, errors: [] as { url: string; error: string }[] };
  const known = new Set<string>();
  const existing = await prisma.item.findMany({ where: { libraryId }, select: { url: true, contentObject: { select: { normalizedUrl: true } }, sourceEntries: { select: { url: true } } } });
  for (const item of existing) for (const raw of [item.url, item.contentObject?.normalizedUrl, ...item.sourceEntries.map(entry => entry.url)]) {
    if (raw) { try { known.add(canonical(raw)); } catch { /* Non-web items. */ } }
  }
  for (const row of rows) {
    let url: string;
    try { url = canonical(row.url); }
    catch { result.invalid++; result.errors.push({ url: row.url, error: "Invalid HTTP(S) URL" }); continue; }
    if (known.has(url)) { result.existing++; continue; }
    if (!apply) { result.missing++; known.add(url); continue; }
    try {
      const sourceId = manualUrlSourceId(libraryId);
      await prisma.source.upsert({ where: { id: sourceId }, update: {}, create: { id: sourceId, libraryId, type: "url", name: "Saved URLs" } });
      const saved = await saveArticleItemToLibrary({ libraryId, sourceId, url, title: row.title, preserveExisting: true,
        initialReadingState: { createdAt: row.savedAt ? new Date(row.savedAt) : undefined, archivedAt: row.archived ? new Date(row.savedAt ?? Date.now()) : null, readingProgress: row.progress },
        startIngestJob: false });
      if ("existingImport" in saved && saved.existingImport) result.existing++; else result.imported++;
      known.add(url);
    } catch (error) { result.failed++; result.errors.push({ url, error: error instanceof Error ? error.message : "Import failed" }); }
  }
  return result;
}
