export type StoredArticleSummary = {
  language: string | null;
  overview: string;
  points: string[];
};

export type SummaryDisplayLanguage = "en" | "zh-Hans";

function containsCjk(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

export function displayLanguageForSummary(summary: StoredArticleSummary | null | undefined): SummaryDisplayLanguage | null {
  if (!summary) return null;
  if (summary.language === "zh-Hans") return "zh-Hans";
  if (summary.language === "en") return "en";
  return containsCjk([summary.overview, ...summary.points].join("\n")) ? "zh-Hans" : "en";
}

export function readLlmSummaryFromMetadata(
  metadataJson: string | null | undefined,
  accountId?: string
): StoredArticleSummary | null {
  if (!metadataJson) return null;

  try {
    const metadata = JSON.parse(metadataJson) as {
      summary?: { overview?: unknown; points?: unknown };
      summaryLanguage?: unknown;
      summaryAccountId?: unknown;
      summarySource?: unknown;
      summaryStatus?: unknown;
    };
    const overview = typeof metadata.summary?.overview === "string" ? metadata.summary.overview.trim() : "";
    const points = Array.isArray(metadata.summary?.points)
      ? metadata.summary.points.filter((point): point is string => typeof point === "string").map((point) => point.trim()).filter(Boolean)
      : [];

    if (metadata.summarySource !== "llm" || metadata.summaryStatus !== "succeeded" || !overview) return null;
    if (accountId && metadata.summaryAccountId !== accountId) return null;

    return {
      language: typeof metadata.summaryLanguage === "string" ? metadata.summaryLanguage : null,
      overview,
      points: points.slice(0, 3)
    };
  } catch {
    return null;
  }
}
