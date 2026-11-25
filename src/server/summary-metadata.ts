import { isSystemLanguage, type SystemLanguage } from "@/app/i18n";

export type StoredArticleSummary = {
  language: string | null;
  overview: string;
  points: string[];
};

export type SummaryDisplayLanguage = SystemLanguage;

function containsHangul(text: string) {
  return /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
}

function containsKana(text: string) {
  return /[\u3040-\u30ff]/.test(text);
}

function containsCjk(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

export function displayLanguageForSummary(summary: StoredArticleSummary | null | undefined): SummaryDisplayLanguage | null {
  if (!summary) return null;
  if (isSystemLanguage(summary.language)) return summary.language;
  const text = [summary.overview, ...summary.points].join("\n");
  if (containsHangul(text)) return "ko";
  if (containsKana(text)) return "ja";
  return containsCjk(text) ? "zh-Hans" : "en";
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
