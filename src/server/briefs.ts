import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function excerpt(text: string, length = 180) {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

export async function getOrCreateTodayBrief() {
  const library = await getCurrentLibrary();
  const date = startOfToday();
  const existing = await prisma.brief.findFirst({
    where: { libraryId: library.id, date },
    orderBy: { createdAt: "desc" }
  });

  if (existing) return existing;

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

  const sections = [
    {
      title: "Today highlights",
      summary:
        items.length > 0
          ? `Curioflow indexed ${items.length} recent item${items.length === 1 ? "" : "s"} across saved URLs, feeds, and uploads.`
          : "No indexed items yet. Add a URL, RSS feed, or PDF to generate a richer briefing.",
      citations: items.slice(0, 3).map((item) => ({
        itemId: item.id,
        title: item.title,
        source: item.source?.name ?? "Library"
      }))
    },
    {
      title: "Worth opening",
      summary:
        items[0]?.document?.text
          ? excerpt(items[0].document.text, 220)
          : "The next ready item will appear here with a short reading cue.",
      citations: items[0]
        ? [{ itemId: items[0].id, title: items[0].title, source: items[0].source?.name ?? "Library" }]
        : []
    },
    {
      title: "Questions to ask",
      summary:
        items.length > 0
          ? "Ask how these saves relate, what to read first, or which documents mention a specific idea."
          : "Once documents are indexed, library ask can answer with citations."
    }
  ];

  return prisma.brief.create({
    data: {
      libraryId: library.id,
      date,
      title: "Daily Briefing",
      summary:
        items.length > 0
          ? `A local briefing from ${items.length} indexed library item${items.length === 1 ? "" : "s"}.`
          : "Your daily briefing will fill in as Curioflow indexes saved material.",
      sectionsJson: JSON.stringify(sections),
      status: "ready"
    }
  });
}
