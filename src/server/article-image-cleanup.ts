import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { prisma } from "./db.ts";
import { articleImageDirectory, ARTICLE_IMAGE_PREFIX } from "./article-images.ts";

function imagePrefixes(itemId: string) {
  return [...new Set([itemId.slice(-2), itemId.slice(0, 2)])]
    .map((shard) => `${ARTICLE_IMAGE_PREFIX}${shard}/${itemId}/`);
}

export function restoreRemoteArticleImages(html: string, prefixes: string[]) {
  const dom = new JSDOM(html);
  try {
    for (const image of dom.window.document.querySelectorAll("img")) {
      const src = image.getAttribute("src");
      if (!src || !prefixes.some((prefix) => src.startsWith(prefix))) continue;
      const original = image.getAttribute("data-original-src");
      if (original && /^https?:\/\//i.test(original)) image.setAttribute("src", original);
      else image.removeAttribute("src");
      image.removeAttribute("srcset");
      image.removeAttribute("data-original-src");
    }
    return dom.window.document.body.innerHTML;
  } finally { dom.window.close(); }
}

/** Call only after the delete transaction commits. Rechecks live references before removing files. */
export async function cleanupDeletedArticleImages(itemId: string, directory = articleImageDirectory()) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/.test(itemId)) return false;
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { deletedAt: true, contentObjectId: true } });
  if (item && !item.deletedAt) return false; // Includes archived and unsaved items.
  const prefixes = imagePrefixes(itemId);
  const documentWhere = { OR: prefixes.map((prefix) => ({ articleHtml: { contains: prefix } })) };
  const activeReference = () => prisma.item.findFirst({
    where: { deletedAt: null, OR: [{ id: itemId }, { document: documentWhere }] }, select: { id: true }
  });
  if (await activeReference()) return false;
  const documents = await prisma.document.findMany({ where: documentWhere, select: { id: true, articleHtml: true, contentObjectId: true } });
  const contentIds = [...new Set([...documents.map((doc) => doc.contentObjectId), ...(item?.contentObjectId ? [item.contentObjectId] : [])])];
  if (contentIds.length && await prisma.job.findFirst({
    where: { contentObjectId: { in: contentIds }, status: { in: ["queued", "running"] } }, select: { id: true }
  })) return false;
  // Cached documents outlive deleted items. Repair them before removing files so
  // restoring/reusing text never produces links to attachments we just deleted.
  for (const document of documents) {
    if (!document.articleHtml) continue;
    await prisma.document.updateMany({
      where: { id: document.id, articleHtml: document.articleHtml },
      data: { articleHtml: restoreRemoteArticleImages(document.articleHtml, prefixes) }
    });
  }
  if (await activeReference()) return false;
  for (const shard of new Set([itemId.slice(-2), itemId.slice(0, 2)])) {
    await rm(join(directory, shard, itemId), { recursive: true, force: true });
  }
  return true;
}

export async function tryCleanupDeletedArticleImages(itemId: string) {
  try { await cleanupDeletedArticleImages(itemId); }
  catch { console.error("Article image cleanup deferred", itemId); }
}

// Retry failed/deferred deletions and catch directories left by interrupted jobs
// or account/source deletion. Never follow symlinks or remove unowned flat files.
export async function cleanupOrphanedArticleImageDirectories(directory = articleImageDirectory()) {
  let shards;
  try { shards = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const shard of shards) {
    if (!shard.isDirectory() || !/^[a-zA-Z0-9_-]{2}$/.test(shard.name)) continue;
    for (const entry of await readdir(join(directory, shard.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || ![entry.name.slice(-2), entry.name.slice(0, 2)].includes(shard.name)) continue;
      try { await cleanupDeletedArticleImages(entry.name, directory); }
      catch { console.error("Article image cleanup deferred", entry.name); }
    }
  }
}
