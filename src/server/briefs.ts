import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { displayLanguageForSummary, readLlmSummaryFromMetadata, type StoredArticleSummary, type SummaryDisplayLanguage } from "@/server/summary-metadata";

const BRIEF_COPY = {
  en: {
    dailyTitle: "Daily Briefing",
    emptySummary: "Your daily briefing will fill in as Curioflow indexes saved material.",
    highlightsEmpty: "No indexed items yet. Add a URL, RSS feed, or PDF to generate a richer briefing.",
    highlightsKicker: "The throughline",
    highlightsSummary: (count: number) => `Curioflow indexed ${count} recent item${count === 1 ? "" : "s"} across saved URLs, feeds, and uploads.`,
    highlightsTitle: "Today highlights",
    localSummary: (count: number) => `A local briefing from ${count} indexed library item${count === 1 ? "" : "s"}.`,
    noSource: "Library",
    worthOpeningEmpty: "The next ready item will appear here with a short reading cue.",
    worthOpeningKicker: "Worth a second look",
    worthOpeningTitle: "Worth opening"
  },
  "zh-Hans": {
    dailyTitle: "每日简报",
    emptySummary: "当 Curioflow 索引已保存内容后，每日简报会在这里生成。",
    highlightsEmpty: "还没有已索引的内容。添加 URL、RSS 订阅或 PDF 后，简报会更丰富。",
    highlightsKicker: "主线",
    highlightsSummary: (count: number) => `Curioflow 已索引 ${count} 条最近保存的 URL、订阅和上传内容。`,
    highlightsTitle: "今日重点",
    localSummary: (count: number) => `基于 ${count} 条已索引资料生成的本地简报。`,
    noSource: "资料库",
    worthOpeningEmpty: "下一篇可阅读内容会在这里显示简短提示。",
    worthOpeningKicker: "值得再看",
    worthOpeningTitle: "值得打开"
  }
} as const;

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function excerpt(text: string, length = 180) {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

function summaryOrExcerpt(document: { metadataJson: string; text: string } | null | undefined, length = 180): StoredArticleSummary | null {
  const summary = readLlmSummaryFromMetadata(document?.metadataJson);
  if (summary) return summary;
  return document?.text ? { language: null, overview: excerpt(document.text, length), points: [] } : null;
}

function briefLanguageForSummaries(summaries: Array<StoredArticleSummary | null>): SummaryDisplayLanguage {
  const counts = summaries.reduce(
    (total, summary) => {
      const language = displayLanguageForSummary(summary);
      if (language) total[language] += 1;
      return total;
    },
    { en: 0, "zh-Hans": 0 }
  );

  return counts["zh-Hans"] > counts.en ? "zh-Hans" : "en";
}

export async function getOrCreateTodayBrief() {
  const library = await getCurrentLibrary();
  const date = startOfToday();
  const existing = await prisma.brief.findFirst({
    where: { libraryId: library.id, date },
    orderBy: { createdAt: "desc" }
  });

  const items = await prisma.item.findMany({
    where: {
      libraryId: library.id,
      savedToLibrary: true,
      archivedAt: null,
      status: "ready",
      documentId: { not: null }
    },
    include: { document: true, source: true },
    orderBy: { createdAt: "desc" },
    take: 8
  });

  const itemSummaries = items.map((item) => summaryOrExcerpt(item.document, 220));
  const briefLanguage = briefLanguageForSummaries(itemSummaries);
  const briefCopy = BRIEF_COPY[briefLanguage];
  const worthOpeningSummary = itemSummaries[0] ?? null;
  const sections = [
    {
      kicker: briefCopy.highlightsKicker,
      title: briefCopy.highlightsTitle,
      summary:
        items.length > 0
          ? briefCopy.highlightsSummary(items.length)
          : briefCopy.highlightsEmpty,
      citations: items.slice(0, 3).map((item) => ({
        itemId: item.id,
        title: item.title,
        source: item.source?.name ?? briefCopy.noSource
      }))
    },
    {
      kicker: briefCopy.worthOpeningKicker,
      title: briefCopy.worthOpeningTitle,
      summary:
        worthOpeningSummary
          ? worthOpeningSummary.overview
          : briefCopy.worthOpeningEmpty,
      points: worthOpeningSummary?.points ?? [],
      citations: items[0]
        ? [{ itemId: items[0].id, title: items[0].title, source: items[0].source?.name ?? briefCopy.noSource }]
        : []
    }
  ];

  const summary =
    items.length > 0
      ? briefCopy.localSummary(items.length)
      : briefCopy.emptySummary;
  const sectionsJson = JSON.stringify(sections);

  if (existing) {
    if (existing.summary === summary && existing.sectionsJson === sectionsJson && existing.status === "ready") {
      return existing;
    }

    return prisma.brief.update({
      where: { id: existing.id },
      data: { summary, sectionsJson, status: "ready" }
    });
  }

  return prisma.brief.create({
    data: {
      libraryId: library.id,
      date,
      title: briefCopy.dailyTitle,
      summary,
      sectionsJson,
      status: "ready"
    }
  });
}
