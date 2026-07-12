import { randomUUID } from "node:crypto";
import { getLlmRuntimeSettingsForAccount } from "@/server/settings";
import { completeTextWithLlm } from "@/server/llm";
import { prisma } from "@/server/db";
import { assertJobLease, claimQueuedJob, fencedJobWhere, type JobLease } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { JOB_STATUS } from "@/server/job-state";
import { parseSummaryResponse } from "@/server/summary-response";
import { readLlmSummaryFromMetadata } from "@/server/summary-metadata";
import { ensureAccountSummaryDocument } from "@/server/document-isolation";
import { consumeManagedUsage, releaseManagedUsage, reserveManagedUsage } from "@/server/usage-reservations";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";

type GeneratedSummary = {
  overview: string;
  points: string[];
};

type SummaryJobPayload = {
  documentId?: string;
  itemId?: string;
  usageReservationId?: string;
};

type RegenerateSummaryInput = {
  accountId?: string;
  itemId: string;
  lease?: JobLease;
  libraryId: string;
  usageReservationId?: string;
};

const SUMMARY_JOB_TYPE = "generate_summary";
const activeSummaryJobAccounts = new Map<string, string>();

function summaryLanguageInstruction(summaryLanguage: string, articleLanguage: string | null | undefined) {
  if (summaryLanguage === "zh-Hans") {
    return [
      "Write the summary in Simplified Chinese.",
      "Keep the JSON keys exactly as requested, but every JSON string value must be written in Simplified Chinese.",
      "Do not write English sentences except proper nouns, product names, company names, or short quoted terms."
    ].join(" ");
  }
  if (summaryLanguage === "en") return "Write the summary in English.";
  return [
    "Write the summary in the original language of the article.",
    articleLanguage ? `The detected article language is ${articleLanguage}.` : "If the language is unclear, infer it from the article text."
  ].join(" ");
}

function containsCjk(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

function validateSummaryLanguage(summary: GeneratedSummary, summaryLanguage: string) {
  if (summaryLanguage !== "zh-Hans") return true;
  return containsCjk([summary.overview, ...summary.points].join("\n"));
}

function summaryMessages(input: {
  articleLanguage: string | null | undefined;
  articleText: string;
  sourceLabel: string;
  summaryLanguage: string;
  title: string;
  retry?: boolean;
}) {
  const languageInstruction = summaryLanguageInstruction(input.summaryLanguage, input.articleLanguage);
  return [
    {
      role: "system" as const,
      content: [
        "You write concise summaries for a personal reading app.",
        "Return only valid JSON with this exact shape: {\"overview\":\"...\",\"points\":[\"...\",\"...\",\"...\"]}.",
        "The overview should be one or two polished sentences.",
        "The points array should contain exactly three concise bullet points.",
        "Do not include markdown, commentary, or citations.",
        languageInstruction,
        input.retry && input.summaryLanguage === "zh-Hans"
          ? "This is a retry because the previous response was not in Simplified Chinese. Translate and summarize the article in Simplified Chinese now."
          : ""
      ].filter(Boolean).join(" ")
    },
    {
      role: "user" as const,
      content: [
        `Title: ${input.title}`,
        `Source: ${input.sourceLabel}`,
        input.summaryLanguage === "zh-Hans" ? "Required output language for JSON values: Simplified Chinese." : "",
        "",
        "Document text:",
        input.articleText.slice(0, 32000)
      ].filter((line, index) => index !== 2 || Boolean(line)).join("\n")
    }
  ];
}

function readMetadata(metadataJson: string) {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hasLlmSummary(metadata: Record<string, unknown>) {
  if (metadata.summarySource !== "llm") return false;
  const summary = metadata.summary as { overview?: unknown } | null | undefined;
  return typeof summary?.overview === "string" && Boolean(summary.overview.trim());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to generate summary";
}

function parseSummaryJobPayload(payloadJson: string): SummaryJobPayload {
  try {
    const payload = JSON.parse(payloadJson) as SummaryJobPayload;
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

async function summaryRegenerationCandidates(libraryId: string) {
  return prisma.item.findMany({
    where: {
      libraryId,
      archivedAt: null,
      deletedAt: null,
      document: {
        is: {
          text: { not: "" }
        }
      }
    },
    select: {
      id: true,
      document: {
        select: {
          metadataJson: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

export type SummaryRegenerationScope = "all" | "missing";

function isSummaryRegenerationCandidate(metadataJson: string, scope: SummaryRegenerationScope, accountId: string) {
  const metadata = readMetadata(metadataJson);
  if (metadata.summaryStatus === "pending") return false;
  return scope === "all" || !readLlmSummaryFromMetadata(metadataJson, accountId);
}

export async function getSummaryRegenerationCandidateCounts(libraryId: string) {
  const [accountId, candidates] = await Promise.all([
    accountIdForLibrary(libraryId),
    summaryRegenerationCandidates(libraryId)
  ]);
  return candidates.reduce(
    (counts, item) => {
      const metadataJson = item.document?.metadataJson ?? "{}";
      if (isSummaryRegenerationCandidate(metadataJson, "all", accountId)) counts.all += 1;
      if (isSummaryRegenerationCandidate(metadataJson, "missing", accountId)) counts.missing += 1;
      return counts;
    },
    { all: 0, missing: 0 }
  );
}

async function markArticleSummaryFailed(documentId: string | undefined, error: unknown) {
  if (!documentId) return;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { metadataJson: true }
  });
  if (!document) return;

  const metadata = readMetadata(document.metadataJson);
  await prisma.document.update({
    where: { id: documentId },
    data: {
      metadataJson: JSON.stringify({
        ...metadata,
        summaryError: errorMessage(error),
        summaryFailedAt: new Date().toISOString(),
        summaryStatus: "failed"
      })
    }
  });
}

async function accountIdForLibrary(libraryId: string) {
  const library = await prisma.library.findUnique({
    where: { id: libraryId },
    select: { accountId: true }
  });
  if (!library) throw new Error("Library not found");
  return library.accountId;
}

async function generateArticleSummary(input: RegenerateSummaryInput) {
  const accountId = input.accountId ?? await accountIdForLibrary(input.libraryId);
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId,
      deletedAt: null,
      document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: accountId }] } }
    },
    include: {
      document: true,
      source: true
    }
  });

  if (!item) throw new Error("Item not found");
  if (!item.document) throw new Error("This item does not have article text yet.");
  if (!item.document.text.trim()) throw new Error("This item does not have article text yet.");

  const summaryDocument = await ensureAccountSummaryDocument(item.id, accountId);
  const settings = await getLlmRuntimeSettingsForAccount(accountId);
  const sourceLabel = item.source?.name ?? item.author ?? "Unknown source";
  const summaryInput = {
    articleLanguage: summaryDocument.language,
    articleText: summaryDocument.text,
    sourceLabel,
    summaryLanguage: settings.summaryLanguage,
    title: item.title
  };
  let responseText = await completeTextWithLlm(
    settings,
    summaryMessages(summaryInput),
    { maxTokens: 650, temperature: 0.2 }
  );
  let summary = parseSummaryResponse(responseText);
  if (!validateSummaryLanguage(summary, settings.summaryLanguage)) {
    responseText = await completeTextWithLlm(
      settings,
      summaryMessages({ ...summaryInput, retry: true }),
      { maxTokens: 650, temperature: 0.2 }
    );
    summary = parseSummaryResponse(responseText);
  }

  if (!validateSummaryLanguage(summary, settings.summaryLanguage)) {
    throw new Error("LLM summary did not match the requested summary language.");
  }

  const metadata = readMetadata(summaryDocument.metadataJson);

  const document = input.lease
    ? await prisma.$transaction(async (tx) => {
        await assertJobLease(tx, input.lease!);
        return tx.document.update({
          where: { id: summaryDocument.id },
          data: {
            metadataJson: JSON.stringify({
              ...metadata,
              summary,
              summaryAccountId: accountId,
              summaryGeneratedAt: new Date().toISOString(),
              summaryLanguage: settings.summaryLanguage,
              summaryModel: settings.model,
              summaryProvider: settings.provider,
              summarySource: "llm",
              summaryStatus: "succeeded",
              summaryError: null
            })
          }
        });
      })
    : await prisma.document.update({
        where: { id: summaryDocument.id },
        data: {
          metadataJson: JSON.stringify({
            ...metadata,
            summary,
            summaryAccountId: accountId,
            summaryGeneratedAt: new Date().toISOString(),
            summaryLanguage: settings.summaryLanguage,
            summaryModel: settings.model,
            summaryProvider: settings.provider,
            summarySource: "llm",
            summaryStatus: "succeeded",
            summaryError: null
          })
        }
      });

  return { document, item };
}

export async function regenerateArticleSummary(input: RegenerateSummaryInput) {
  const accountId = input.accountId ?? await accountIdForLibrary(input.libraryId);
  const ownsReservation = !input.usageReservationId;
  const reservation = input.usageReservationId
    ? { id: input.usageReservationId }
    : await reserveManagedUsage({
        accountId,
        eventType: "summary_generation",
        idempotencyKey: `summary:${accountId}:${input.itemId}:${randomUUID()}`
      });
  try {
    const result = await generateArticleSummary({ ...input, accountId });
    await consumeManagedUsage(reservation.id);
    return result;
  } catch (error) {
    if (ownsReservation) await releaseManagedUsage(reservation.id);
    throw error;
  }
}

export async function enqueueArticleSummaryGeneration(input: { itemId: string; libraryId: string; force?: boolean; includeUnsaved?: boolean }) {
  const accountId = await accountIdForLibrary(input.libraryId);
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId,
      deletedAt: null,
      document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: accountId }] } },
      ...(input.includeUnsaved ? {} : { savedToLibrary: true })
    },
    include: {
      document: true
    }
  });

  if (!item?.document?.text.trim()) {
    return { status: "skipped" as const };
  }

  const summaryDocument = await ensureAccountSummaryDocument(item.id, accountId);
  const metadata = readMetadata(summaryDocument.metadataJson);
  if (!input.force) {
    if (metadata.summaryStatus === "pending") return { status: "skipped" as const };
    if (hasLlmSummary(metadata)) return { status: "skipped" as const };
  }

  const requestedAt = new Date().toISOString();
  const reservation = await reserveManagedUsage({
    accountId,
    eventType: "summary_generation",
    idempotencyKey: `summary-job:${accountId}:${item.id}:${randomUUID()}`
  });
  let job;
  try {
    const result = await prisma.$transaction([
      prisma.document.update({
        where: { id: summaryDocument.id },
        data: {
          metadataJson: JSON.stringify({
            ...metadata,
            summaryAccountId: accountId,
            summaryError: null,
            summaryRequestedAt: requestedAt,
            summaryStatus: "pending"
          })
        }
      }),
      prisma.job.create({
        data: {
          libraryId: input.libraryId,
          contentObjectId: item.contentObjectId ?? summaryDocument.contentObjectId,
          type: SUMMARY_JOB_TYPE,
          status: "queued",
          progressJson: serializeJobProgress({
            stage: "queued",
            itemId: item.id,
            documentId: summaryDocument.id
          }),
          payloadJson: JSON.stringify({
            documentId: summaryDocument.id,
            itemId: item.id,
            usageReservationId: reservation.id
          })
        }
      })
    ]);
    job = result[1];
  } catch (error) {
    await releaseManagedUsage(reservation.id);
    throw error;
  }

  await startArticleSummaryJob(job.id);
  return { status: "queued" as const, jobId: job.id };
}

export async function enqueueLibrarySummaryRegeneration(input: { libraryId: string; scope: SummaryRegenerationScope }) {
  const [accountId, candidates] = await Promise.all([
    accountIdForLibrary(input.libraryId),
    summaryRegenerationCandidates(input.libraryId)
  ]);
  let queued = 0;
  let skipped = 0;

  for (const item of candidates) {
    if (!isSummaryRegenerationCandidate(item.document?.metadataJson ?? "{}", input.scope, accountId)) {
      skipped += 1;
      continue;
    }

    const result = await enqueueArticleSummaryGeneration({
      libraryId: input.libraryId,
      itemId: item.id,
      force: true,
      includeUnsaved: true
    });

    if (result.status === "queued") queued += 1;
    else skipped += 1;
  }

  return { queued, skipped, total: candidates.length };
}

async function summaryConcurrencyForLibrary(libraryId: string) {
  const accountId = await accountIdForLibrary(libraryId);
  const settings = await getLlmRuntimeSettingsForAccount(accountId);
  return { accountId, concurrency: settings.summaryConcurrency };
}

async function summaryConcurrencyForJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { libraryId: true }
  });
  if (!job?.libraryId) return null;
  return summaryConcurrencyForLibrary(job.libraryId);
}

function activeSummaryCount(accountId: string) {
  return Array.from(activeSummaryJobAccounts.values()).filter((activeAccountId) => activeAccountId === accountId).length;
}

export async function startArticleSummaryJob(jobId: string) {
  if (!backgroundWorkRunsHere()) return false;
  if (activeSummaryJobAccounts.has(jobId)) return false;
  const policy = await summaryConcurrencyForJob(jobId);
  if (!policy || activeSummaryCount(policy.accountId) >= policy.concurrency) return false;

  activeSummaryJobAccounts.set(jobId, policy.accountId);
  void runArticleSummaryJob(jobId);
  return true;
}

async function runArticleSummaryJob(jobId: string) {
  let libraryId: string | null = null;

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { libraryId: true }
    });
    libraryId = job?.libraryId ?? null;
    await processArticleSummaryJob(jobId);
  } catch (error) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    libraryId = job?.libraryId ?? libraryId;
    const payload = job ? parseSummaryJobPayload(job.payloadJson) : {};

    const result = await recordBackgroundJobFailure(jobId, error);
    if (result.status === "failed") {
      await markArticleSummaryFailed(payload.documentId, error);
    }
  } finally {
    activeSummaryJobAccounts.delete(jobId);
    if (libraryId) {
      void wakeNextArticleSummaryJob(libraryId);
    }
  }
}

async function wakeNextArticleSummaryJob(libraryId: string) {
  const policy = await summaryConcurrencyForLibrary(libraryId);
  if (activeSummaryCount(policy.accountId) >= policy.concurrency) return;

  const now = new Date();
  const job = await prisma.job.findFirst({
    where: {
      library: { accountId: policy.accountId },
      status: JOB_STATUS.QUEUED,
      type: SUMMARY_JOB_TYPE,
      AND: [
        {
          OR: [
            { nextRunAt: null },
            { nextRunAt: { lte: now } }
          ]
        },
        {
          OR: [
            { lockedUntil: null },
            { lockedUntil: { lte: now } }
          ]
        }
      ]
    },
    orderBy: { createdAt: "asc" }
  });

  if (job) startArticleSummaryJob(job.id);
}

export async function processArticleSummaryJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { library: { select: { accountId: true } } }
  });
  if (!job?.libraryId || !job.library) {
    throw new Error("Summary job not found");
  }

  const payload = parseSummaryJobPayload(job.payloadJson);
  if (!payload.itemId) {
    throw new Error("Summary job payload is missing an item id");
  }

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await updateJobProgress(job.id, {
      stage: "generating_summary",
      itemId: payload.itemId,
      documentId: payload.documentId ?? null
    }, claimed);

    await regenerateArticleSummary({
      accountId: job.library.accountId,
      itemId: payload.itemId,
      lease: claimed,
      libraryId: job.libraryId,
      usageReservationId: payload.usageReservationId
    });

    await prisma.job.updateMany({
      where: fencedJobWhere(claimed),
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        lockedUntil: null,
        leaseOwner: null,
        nextRunAt: null,
        progressJson: serializeJobProgress({
          stage: "succeeded",
          itemId: payload.itemId,
          documentId: payload.documentId ?? null
        })
      }
    });
  } catch (error) {
    const result = await recordBackgroundJobFailure(job.id, error, claimed);
    if (result.status === "failed") {
      await markArticleSummaryFailed(payload.documentId, error);
      await releaseManagedUsage(payload.usageReservationId);
    }
  }
}
