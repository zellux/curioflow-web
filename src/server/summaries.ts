import { getLlmRuntimeSettingsForCurrentAccount } from "@/server/settings";
import { completeTextWithLlm } from "@/server/llm";
import { prisma } from "@/server/db";

type GeneratedSummary = {
  overview: string;
  points: string[];
};

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
          "Article text:",
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
        summarySource: "llm"
      })
    }
  });

  return { document, item };
}
