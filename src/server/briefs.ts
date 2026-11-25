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
  },
  "zh-Hant": {
    dailyTitle: "每日簡報",
    emptySummary: "當 Curioflow 索引已儲存內容後，每日簡報會在這裡產生。",
    highlightsEmpty: "還沒有已索引的內容。新增 URL、RSS 訂閱或 PDF 後，簡報會更豐富。",
    highlightsKicker: "主線",
    highlightsSummary: (count: number) => `Curioflow 已索引 ${count} 筆最近儲存的 URL、訂閱和上傳內容。`,
    highlightsTitle: "今日重點",
    localSummary: (count: number) => `基於 ${count} 筆已索引資料產生的本機簡報。`,
    noSource: "資料庫",
    worthOpeningEmpty: "下一篇可閱讀內容會在這裡顯示簡短提示。",
    worthOpeningKicker: "值得再看",
    worthOpeningTitle: "值得開啟"
  },
  ja: {
    dailyTitle: "デイリーブリーフィング",
    emptySummary: "保存した記事がインデックスされると、ここにデイリーブリーフィングが表示されます。",
    highlightsEmpty: "インデックス済みの記事はまだありません。URL、RSS フィード、または PDF を追加してください。",
    highlightsKicker: "テーマ",
    highlightsSummary: (count: number) => `保存した URL、フィード、アップロードから最近 ${count} 件の記事をインデックスしました。`,
    highlightsTitle: "今日のハイライト",
    localSummary: (count: number) => `${count} 件のインデックス済み記事から作成したローカルブリーフィングです。`,
    noSource: "ライブラリ",
    worthOpeningEmpty: "次に読むおすすめ記事がここに表示されます。",
    worthOpeningKicker: "もう一度チェック",
    worthOpeningTitle: "おすすめの記事"
  },
  ko: {
    dailyTitle: "데일리 브리핑",
    emptySummary: "저장된 자료가 색인되면 여기에 데일리 브리핑이 채워집니다.",
    highlightsEmpty: "아직 색인된 항목이 없습니다. URL, RSS 피드 또는 PDF를 추가해 보세요.",
    highlightsKicker: "핵심 흐름",
    highlightsSummary: (count: number) => `저장된 URL, 피드, 업로드에서 최근 항목 ${count}개를 색인했습니다.`,
    highlightsTitle: "오늘의 하이라이트",
    localSummary: (count: number) => `색인된 라이브러리 항목 ${count}개로 만든 로컬 브리핑입니다.`,
    noSource: "라이브러리",
    worthOpeningEmpty: "다음에 읽을 수 있는 글이 짧은 안내와 함께 여기에 표시됩니다.",
    worthOpeningKicker: "다시 볼 만한 글",
    worthOpeningTitle: "열어볼 만한 글"
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
  const counts: Record<SummaryDisplayLanguage, number> = {
    en: 0,
    "zh-Hans": 0,
    "zh-Hant": 0,
    ja: 0,
    ko: 0
  };
  for (const summary of summaries) {
    const language = displayLanguageForSummary(summary);
    if (language) counts[language] += 1;
  }

  let best: SummaryDisplayLanguage = "en";
  for (const candidate of ["zh-Hans", "zh-Hant", "ja", "ko"] as const) {
    if (counts[candidate] > counts[best]) best = candidate;
  }
  return best;
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
      deletedAt: null,
      status: "ready",
      documentId: { not: null },
      document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } }
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
