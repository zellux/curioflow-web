import { getLlmRuntimeSettingsForCurrentAccount } from "@/server/settings";
import { completeTextWithLlm } from "@/server/llm";
import { prisma } from "@/server/db";

type GeneratedSummary = {
  overview: string;
  points: string[];
};

type SummaryJobPayload = {
  documentId?: string;
  itemId?: string;
};

const SUMMARY_JOB_TYPE = "generate_summary";

function summaryLanguageInstruction(summaryLanguage: string, articleLanguage: string | null | undefined) {
  if (summaryLanguage === "zh-Hans") return "Write the summary in Simplified Chinese.";
  if (summaryLanguage === "en") return "Write the summary in English.";
  return [
    "Write the summary in the original language of the article.",
    articleLanguage ? `The detected article language is ${articleLanguage}.` : "If the language is unclear, infer it from the article text."
  ].join(" ");
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
  const languageInstruction = summaryLanguageInstruction(settings.summaryLanguage, item.document.language);
  const sourceLabel = item.source?.name ?? item.author ?? "Unknown source";
  const responseText = await completeTextWithLlm(
    settings,
    [
      {
        role: "system",
        content: [
          "You write concise summaries for a personal reading app.",
          "Return only valid JSON with this exact shape: {\"overview\":\"...\",\"points\":[\"...\",\"...\",\"...\"]}.",
          "The overview should be one or two polished sentences.",
          "The points array should contain exactly three concise bullet points.",
          "Do not include markdown, commentary, or citations.",
          languageInstruction
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Title: ${item.title}`,
          `Source: ${sourceLabel}`,
          "",
          "Document text:",
          item.document.text.slice(0, 32000)
        ].join("\n")
      }
    ],
    { maxTokens: 650, temperature: 0.2 }
  );
  const summary = parseSummaryResponse(responseText);
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

export async function enqueueArticleSummaryGeneration(input: { itemId: string; libraryId: string; force?: boolean }) {
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId,
      savedToLibrary: true
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

export function startArticleSummaryJob(jobId: string) {
  void processArticleSummaryJob(jobId).catch(async (error) => {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    const payload = job ? parseSummaryJobPayload(job.payloadJson) : {};

    await Promise.all([
      markArticleSummaryFailed(payload.documentId, error),
      prisma.job.updateMany({
        where: { id: jobId, status: { not: "failed" } },
        data: {
          status: "failed",
          error: errorMessage(error),
          finishedAt: new Date()
        }
      })
    ]);
  });
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

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "running",
      startedAt: job.startedAt ?? new Date()
    }
  });

  try {
    await regenerateArticleSummary({
      itemId: payload.itemId,
      libraryId: job.libraryId
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finishedAt: new Date()
      }
    });
  } catch (error) {
    await Promise.all([
      markArticleSummaryFailed(payload.documentId, error),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: errorMessage(error),
          finishedAt: new Date()
        }
      })
    ]);
  }
}
