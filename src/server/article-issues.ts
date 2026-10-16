import { prisma } from "@/server/db";
import { hasFailedArticleSummary } from "@/server/summary-failure-state";

// Current article state is authoritative; old failed jobs are only diagnostic detail.
export async function getArticleIssues(libraryId: string) {
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, select: { accountId: true } });
  const items = await prisma.item.findMany({
    where: { libraryId, type: "article", deletedAt: null,
      OR: [{ documentId: null }, { document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } } }] },
    select: { id: true, title: true, status: true, contentObjectId: true, updatedAt: true, document: { select: { metadataJson: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
  });
  const affected = items.filter(item => item.status === "failed" || (item.document && hasFailedArticleSummary(item.document.metadataJson)));
  if (!affected.length) return [];
  const jobs = await prisma.job.findMany({
    where: { libraryId, status: { in: ["failed", "queued", "running"] }, type: { in: ["generate_summary", "ingest_url", "refetch_article"] } },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]
  });
  const byItem = new Map<string, typeof jobs[number]>();
  const byContent = new Map<string, typeof jobs[number]>();
  const activeByItem = new Map<string, string>();
  const activeByContent = new Map<string, string>();
  for (const job of jobs) {
    const key = (id: string) => `${id}:${job.type === "generate_summary" ? "summary" : "content"}`;
    let itemId: unknown;
    try { itemId = JSON.parse(job.payloadJson)?.itemId; } catch { /* Legacy malformed payload. */ }
    if (job.status !== "failed") {
      if (typeof itemId === "string") activeByItem.set(key(itemId), job.id);
      else if (job.contentObjectId) activeByContent.set(key(job.contentObjectId), job.id);
      continue;
    }
    if (typeof itemId === "string") {
      if (!byItem.has(key(itemId))) byItem.set(key(itemId), job);
    } else if (job.contentObjectId && !byContent.has(key(job.contentObjectId))) {
      byContent.set(key(job.contentObjectId), job);
    }
  }
  return affected.map(item => {
    const kind = item.status === "failed" ? "content" : "summary";
    return { id: item.id, title: item.title, kind,
      activeJobId: activeByItem.get(`${item.id}:${kind}`) ?? (item.contentObjectId ? activeByContent.get(`${item.contentObjectId}:${kind}`) : undefined) ?? null,
      job: byItem.get(`${item.id}:${kind}`) ?? (item.contentObjectId ? byContent.get(`${item.contentObjectId}:${kind}`) : undefined) ?? null };
  });
}
