// Evaluated inside the target app container, using its deployed ingest implementation.
import { prisma } from "@/server/db";
import { normalizeUrl } from "@/server/ingest/articles";
import { saveUrlToLibrary } from "@/server/ingest/url";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { libraryId, urls, apply } = JSON.parse(input);
if (typeof libraryId !== "string" || !Array.isArray(urls) || typeof apply !== "boolean") throw new Error("Invalid sync input");
const canonical = value => {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) throw new Error("Expected an absolute HTTP(S) URL");
  const result = normalizeUrl(value);
  if (new URL(result).username || new URL(result).password) throw new Error("URL credentials are not supported");
  return result;
};
const report = { mode: apply ? "apply" : "preview", libraryId, counts: { missing: 0, existing: 0, duplicate: 0, imported: 0, failed: 0 }, items: [] };
try {
  if (!await prisma.library.findUnique({ where: { id: libraryId }, select: { id: true } })) throw new Error("Unknown target library");
  // Include archived/deleted items and original source URLs to preserve existing state.
  const existing = new Set();
  const items = await prisma.item.findMany({ where: { libraryId }, select: { url: true, contentObject: { select: { normalizedUrl: true } }, sourceEntries: { select: { url: true } } } });
  for (const item of items) for (const url of [item.url, item.contentObject?.normalizedUrl, ...item.sourceEntries.map(entry => entry.url)]) {
    try { existing.add(canonical(url)); } catch { /* Non-URL items have no comparison key. */ }
  }
  const seen = new Set();
  for (const raw of urls) {
    let url = raw;
    try {
      url = canonical(raw);
      if (seen.has(url)) { report.counts.duplicate++; continue; }
      seen.add(url);
      if (existing.has(url)) { report.counts.existing++; report.items.push({ url, outcome: "existing" }); continue; }
      // Recheck the canonical identity immediately before saving, in case ingestion has advanced.
      if (await prisma.item.findFirst({ where: { libraryId, OR: [{ url }, { contentObject: { normalizedUrl: url } }, { sourceEntries: { some: { url } } }] }, select: { id: true } })) {
        report.counts.existing++; report.items.push({ url, outcome: "existing" }); continue;
      }
      report.counts.missing++;
      if (!apply) { report.items.push({ url, outcome: "missing" }); continue; }
      const item = await saveUrlToLibrary(libraryId, url);
      existing.add(url);
      report.counts.imported++;
      report.items.push({ url, outcome: "imported", itemId: item.id, status: item.status });
    } catch (error) {
      report.counts.failed++;
      report.items.push({ url, outcome: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(`CURIOFLOW_URL_SYNC_RESULT=${JSON.stringify(report)}`);
  if (report.counts.failed) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
