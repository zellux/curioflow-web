import { createHash, randomBytes } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { formatAccountExportMarkdown, formatAccountExportOpml } from "@/server/account-export-format";

const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD_TOKEN_MS = 15 * 60 * 1000;
const storageRoot = resolve(process.cwd(), "storage");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function storagePath(storageKey: string) {
  const path = resolve(storageRoot, storageKey);
  if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error("Export storage key is invalid");
  return path;
}

function parsedJson(value: string | null) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export async function enqueueAccountExport(accountId: string) {
  const existing = await prisma.accountExport.findFirst({
    where: { accountId, status: { in: ["queued", "running"] } },
    orderBy: { requestedAt: "desc" }
  });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const accountExport = await tx.accountExport.create({ data: { accountId } });
      await tx.job.create({
        data: {
          type: BACKGROUND_JOB_TYPES.EXPORT_ACCOUNT,
          status: "queued",
          progressJson: serializeJobProgress({ stage: "queued", exportId: accountExport.id }),
          payloadJson: JSON.stringify({ accountId, exportId: accountExport.id })
        }
      });
      return accountExport;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.accountExport.findFirst({
      where: { accountId, status: { in: ["queued", "running"] } },
      orderBy: { requestedAt: "desc" }
    });
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function exportPayload(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      user: { select: { id: true, displayName: true, email: true, username: true, createdAt: true } },
      readingPreference: true,
      llmSettings: {
        select: {
          enabled: true,
          provider: true,
          baseUrl: true,
          model: true,
          askModel: true,
          systemLanguage: true,
          summaryLanguage: true,
          summaryConcurrency: true,
          createdAt: true,
          updatedAt: true
        }
      },
      libraries: {
        include: {
          sources: true,
          briefs: true,
          chats: { include: { messages: true } },
          items: {
            where: { deletedAt: null },
            include: {
              source: true,
              sourceEntries: { include: { source: true } },
              annotations: { where: { user: { accountId } } },
              document: { include: { cachedFile: true } }
            }
          }
        }
      }
    }
  });

  return {
    format: "curioflow-account-export",
    version: 1,
    generatedAt: new Date().toISOString(),
    account: {
      id: account.id,
      name: account.name,
      createdAt: account.createdAt,
      user: account.user,
      readingPreference: account.readingPreference,
      llmSettings: account.llmSettings,
      libraries: account.libraries.map((library) => ({
        id: library.id,
        name: library.name,
        createdAt: library.createdAt,
        sources: library.sources,
        briefs: library.briefs,
        chats: library.chats,
        items: library.items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          url: item.url,
          author: item.author,
          publishedAt: item.publishedAt,
          status: item.status,
          readStatus: item.readStatus,
          savedToLibrary: item.savedToLibrary,
          readingProgress: item.readingProgress,
          readingPosition: parsedJson(item.readingPositionJson),
          lastReadAt: item.lastReadAt,
          archivedAt: item.archivedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          source: item.source,
          sourceOccurrences: item.sourceEntries.map((entry) => ({
            sourceId: entry.sourceId,
            sourceName: entry.source.name,
            entryKey: entry.entryKey,
            url: entry.url,
            title: entry.title,
            author: entry.author,
            publishedAt: entry.publishedAt,
            firstSeenAt: entry.firstSeenAt,
            lastSeenAt: entry.lastSeenAt
          })),
          annotations: item.annotations.map((annotation) => ({
            id: annotation.id,
            quote: annotation.quote,
            note: annotation.note,
            location: parsedJson(annotation.locationJson),
            createdAt: annotation.createdAt,
          })),
          document: item.document && (!item.document.ownerAccountId || item.document.ownerAccountId === accountId)
            ? {
                id: item.document.id,
                contentType: item.document.contentType,
                title: item.document.title,
                articleHtml: item.document.articleHtml,
                text: item.document.text,
                contentHash: item.document.contentHash,
                parserVersion: item.document.parserVersion,
                language: item.document.language,
                metadata: parsedJson(item.document.metadataJson),
                createdAt: item.document.createdAt,
                privateFile: item.document.cachedFile
                  ? {
                      filename: item.document.cachedFile.originalFilename,
                      mimeType: item.document.cachedFile.mimeType,
                      byteSize: item.document.cachedFile.byteSize,
                      fileSha256: item.document.cachedFile.fileSha256
                    }
                  : null
              }
            : null
        }))
      }))
    }
  };
}

export async function processAccountExportJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.type !== BACKGROUND_JOB_TYPES.EXPORT_ACCOUNT) throw new Error("Account export job not found");
  const payload = JSON.parse(job.payloadJson) as { accountId?: string; exportId?: string };
  if (!payload.accountId || !payload.exportId) throw new Error("Account export job payload is incomplete");
  const accountExport = await prisma.accountExport.findFirst({
    where: { id: payload.exportId, accountId: payload.accountId }
  });
  if (!accountExport) throw new Error("Account export request not found");

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;
  try {
    await prisma.accountExport.update({ where: { id: accountExport.id }, data: { status: "running", error: null } });
    await updateJobProgress(job.id, { stage: "collecting_account_data", exportId: accountExport.id }, claimed);
    const data = await exportPayload(payload.accountId);
    const directoryKey = `exports/${sha256(payload.accountId)}/${accountExport.id}`;
    const jsonStorageKey = `${directoryKey}/curioflow-export.json`;
    const markdownStorageKey = `${directoryKey}/curioflow-library.md`;
    const opmlStorageKey = `${directoryKey}/curioflow-subscriptions.opml`;
    await mkdir(storagePath(directoryKey), { recursive: true });
    await Promise.all([
      writeFile(storagePath(jsonStorageKey), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 }),
      writeFile(storagePath(markdownStorageKey), formatAccountExportMarkdown(data), { mode: 0o600 }),
      writeFile(storagePath(opmlStorageKey), formatAccountExportOpml(data), { mode: 0o600 })
    ]);

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.accountExport.update({
        where: { id: accountExport.id },
        data: {
          status: "ready",
          jsonStorageKey,
          markdownStorageKey,
          opmlStorageKey,
          completedAt: new Date(),
          retainedUntil: new Date(Date.now() + EXPORT_RETENTION_MS)
        }
      });
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          progressJson: serializeJobProgress({ stage: "succeeded", exportId: accountExport.id })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
  } catch (error) {
    const result = await recordBackgroundJobFailure(job.id, error, claimed);
    if (result.status === "ignored") return;
    await prisma.accountExport.update({
      where: { id: accountExport.id },
      data: {
        status: result.status === "failed" ? "failed" : "queued",
        error: result.status === "failed" ? (error instanceof Error ? error.message : "Export failed") : null
      }
    });
  }
}

export async function issueAccountExportDownloads(accountId: string, exportId: string) {
  const accountExport = await prisma.accountExport.findFirst({
    where: { id: exportId, accountId, status: "ready", retainedUntil: { gt: new Date() } }
  });
  if (!accountExport?.jsonStorageKey || !accountExport.markdownStorageKey || !accountExport.opmlStorageKey) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DOWNLOAD_TOKEN_MS);
  await prisma.accountExport.update({
    where: { id: accountExport.id },
    data: { downloadTokenHash: sha256(token), downloadExpiresAt: expiresAt }
  });
  const base = `/api/account/export/download?token=${encodeURIComponent(token)}`;
  return {
    expiresAt: expiresAt.toISOString(),
    json: `${base}&format=json`,
    markdown: `${base}&format=markdown`,
    opml: `${base}&format=opml`
  };
}

export async function resolveAccountExportDownload(token: string, format: string) {
  const accountExport = await prisma.accountExport.findFirst({
    where: {
      downloadTokenHash: sha256(token),
      downloadExpiresAt: { gt: new Date() },
      retainedUntil: { gt: new Date() },
      status: "ready"
    }
  });
  if (!accountExport) return null;
  const files = {
    json: { key: accountExport.jsonStorageKey, contentType: "application/json", filename: "curioflow-export.json" },
    markdown: { key: accountExport.markdownStorageKey, contentType: "text/markdown; charset=utf-8", filename: "curioflow-library.md" },
    opml: { key: accountExport.opmlStorageKey, contentType: "text/x-opml; charset=utf-8", filename: "curioflow-subscriptions.opml" }
  } as const;
  const file = files[format as keyof typeof files];
  if (!file?.key) return null;
  const path = storagePath(file.key);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  await prisma.accountExport.update({ where: { id: accountExport.id }, data: { downloadedAt: new Date() } });
  return { ...file, path };
}

export async function cleanupExpiredAccountExports() {
  const expired = await prisma.accountExport.findMany({
    where: { retainedUntil: { lte: new Date() }, status: { in: ["ready", "expired"] } }
  });
  for (const accountExport of expired) {
    for (const key of [accountExport.jsonStorageKey, accountExport.markdownStorageKey, accountExport.opmlStorageKey]) {
      if (key) await unlink(storagePath(key)).catch(() => undefined);
    }
    await prisma.accountExport.update({
      where: { id: accountExport.id },
      data: {
        status: "expired",
        jsonStorageKey: null,
        markdownStorageKey: null,
        opmlStorageKey: null,
        downloadTokenHash: null,
        downloadExpiresAt: null
      }
    });
  }
  return expired.length;
}
