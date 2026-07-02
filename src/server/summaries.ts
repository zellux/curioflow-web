import { getLlmRuntimeSettingsForCurrentAccount } from "@/server/settings";
import { completeTextWithLlm } from "@/server/llm";
import { prisma } from "@/server/db";
import { claimQueuedJob } from "@/server/job-claim";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { JOB_STATUS } from "@/server/job-state";

type GeneratedSummary = {
  overview: string;
  points: string[];
};

type SummaryJobPayload = {
  documentId?: string;
  itemId?: string;
};

const SUMMARY_JOB_TYPE = "generate_summary";
const SUMMARY_JOB_CONCURRENCY = 1;
const activeSummaryJobIds = new Set<string>();

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

function parseSummaryResponse(text: string): GeneratedSummary {
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(candidate) as { overview?: unknown; points?: unknown };
  const overview = typeof parsed.overview === "string" ? parsed.overview.trim() : "";
  const points = Array.isArray(parsed.points)
    ? parsed.points.filter((point): point is string => typeof point === "string").map((point) => point.trim()).filter(Boolean)
    : [];

  if (!overview || points.length === 0) {
    throw new Error("LLM summary response was missing overview or points.");
  }

  return {
    overview,
    points: points.slice(0, 3)
  };
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

function isSummaryPending(metadataJson: string) {
  return readMetadata(metadataJson).summaryStatus === "pending";
}

async function summaryRegenerationCandidates(libraryId: string) {
  return prisma.item.findMany({
    where: {
      libraryId,
      archivedAt: null,
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

export async function getSummaryRegenerationCandidateCount(libraryId: string) {
  const candidates = await summaryRegenerationCandidates(libraryId);
  return candidates.filter((item) => !isSummaryPending(item.document?.metadataJson ?? "{}")).length;
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

export async function regenerateArticleSummary(input: { itemId: string; libraryId: string }) {
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId
    },
    include: {
      document: true,
      source: true
    }
  });

  if (!item) throw new Error("Item not found");
  if (!item.document) throw new Error("This item does not have article text yet.");
  if (!item.document.text.trim()) throw new Error("This item does not have article text yet.");

  const settings = await getLlmRuntimeSettingsForCurrentAccount();
  const sourceLabel = item.source?.name ?? item.author ?? "Unknown source";
  const summaryInput = {
    articleLanguage: item.document.language,
    articleText: item.document.text,
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

  const metadata = readMetadata(item.document.metadataJson);

  const document = await prisma.document.update({
    where: { id: item.document.id },
    data: {
      metadataJson: JSON.stringify({
        ...metadata,
        summary,
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

export async function enqueueArticleSummaryGeneration(input: { itemId: string; libraryId: string; force?: boolean; includeUnsaved?: boolean }) {
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId,
      ...(input.includeUnsaved ? {} : { savedToLibrary: true })
    },
    include: {
      document: true
    }
  });

  if (!item?.document?.text.trim()) {
    return { status: "skipped" as const };
  }

  const metadata = readMetadata(item.document.metadataJson);
  if (!input.force) {
    if (metadata.summaryStatus === "pending") return { status: "skipped" as const };
    if (hasLlmSummary(metadata)) return { status: "skipped" as const };
  }

  const requestedAt = new Date().toISOString();
  const [, job] = await prisma.$transaction([
    prisma.document.update({
      where: { id: item.document.id },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          summaryError: null,
          summaryRequestedAt: requestedAt,
          summaryStatus: "pending"
        })
      }
    }),
    prisma.job.create({
      data: {
        libraryId: input.libraryId,
        contentObjectId: item.contentObjectId ?? item.document.contentObjectId,
        type: SUMMARY_JOB_TYPE,
        status: "queued",
        payloadJson: JSON.stringify({
          documentId: item.document.id,
          itemId: item.id
        })
      }
    })
  ]);

  startArticleSummaryJob(job.id);
  return { status: "queued" as const, jobId: job.id };
}

export async function enqueueLibrarySummaryRegeneration(input: { libraryId: string }) {
  const candidates = await summaryRegenerationCandidates(input.libraryId);
  let queued = 0;
  let skipped = 0;

  for (const item of candidates) {
    if (isSummaryPending(item.document?.metadataJson ?? "{}")) {
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

export function startArticleSummaryJob(jobId: string) {
  if (activeSummaryJobIds.has(jobId)) return false;
  if (activeSummaryJobIds.size >= SUMMARY_JOB_CONCURRENCY) return false;

  activeSummaryJobIds.add(jobId);
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
    activeSummaryJobIds.delete(jobId);
    if (libraryId) {
      void wakeNextArticleSummaryJob(libraryId);
    }
  }
}

async function wakeNextArticleSummaryJob(libraryId: string) {
  if (activeSummaryJobIds.size >= SUMMARY_JOB_CONCURRENCY) return;

  const now = new Date();
  const job = await prisma.job.findFirst({
    where: {
      libraryId,
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
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.libraryId) {
    throw new Error("Summary job not found");
  }

  const payload = parseSummaryJobPayload(job.payloadJson);
  if (!payload.itemId) {
    throw new Error("Summary job payload is missing an item id");
  }

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await regenerateArticleSummary({
      itemId: payload.itemId,
      libraryId: job.libraryId
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        lockedUntil: null,
        nextRunAt: null
      }
    });
  } catch (error) {
    const result = await recordBackgroundJobFailure(job.id, error);
    if (result.status === "failed") {
      await markArticleSummaryFailed(payload.documentId, error);
    }
  }
}
