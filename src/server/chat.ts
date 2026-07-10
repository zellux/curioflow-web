import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

type Citation = {
  itemId: string;
  documentId: string;
  title: string;
  source: string;
  quote: string;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "anything",
  "are",
  "does",
  "for",
  "from",
  "has",
  "how",
  "into",
  "library",
  "say",
  "that",
  "the",
  "their",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your"
]);

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  );
}

function scoreText(questionTokens: Set<string>, text: string) {
  const textTokens = tokenize(text);
  let score = 0;
  for (const token of questionTokens) {
    if (textTokens.has(token)) score += 1;
  }
  return score;
}

function clip(text: string, length = 320) {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

function buildAnswer(question: string, citations: Citation[]) {
  if (citations.length === 0) {
    return `I could not find a strong local citation for "${question}" yet. Add or index more material, then ask again.`;
  }

  const names = citations.map((citation) => citation.title).join(", ");
  return `I found ${citations.length} relevant passage${citations.length === 1 ? "" : "s"} in your library: ${names}. The strongest local evidence says: ${citations[0].quote}`;
}

export async function askLibrary(question: string, itemId?: string | null) {
  const library = await getCurrentLibrary();
  const trimmed = question.trim();
  if (!trimmed) throw new Error("question is required");

  const candidateItems = await prisma.item.findMany({
    where: {
      libraryId: library.id,
      ...(itemId ? { id: itemId } : {}),
      ...(itemId ? {} : { savedToLibrary: true }),
      deletedAt: null,
      documentId: { not: null },
      document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: library.accountId }] } }
    },
    include: {
      source: true,
      document: {
        include: {
          chunks: {
            orderBy: { chunkIndex: "asc" }
          }
        }
      }
    },
    take: 80
  });

  const questionTokens = tokenize(trimmed);
  const minimumScore = questionTokens.size > 1 ? 2 : 1;
  const scored = candidateItems
    .flatMap((item) =>
      (item.document?.chunks ?? []).map((chunk) => ({
        item,
        chunk,
        score:
          scoreText(questionTokens, chunk.text) +
          scoreText(questionTokens, item.title) * 2 +
          scoreText(questionTokens, item.document?.title ?? "") * 2
      }))
    )
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, 4);

  const citations = scored.map<Citation>((entry) => ({
    itemId: entry.item.id,
    documentId: entry.chunk.documentId,
    title: entry.item.title,
    source: entry.item.source?.name ?? "Library",
    quote: clip(entry.chunk.text)
  }));

  const thread = await prisma.chatThread.create({
    data: {
      libraryId: library.id,
      scope: itemId ? "item" : "library",
      itemId: itemId ?? null,
      title: trimmed.slice(0, 80),
      messages: {
        create: [
          { role: "user", content: trimmed },
          {
            role: "assistant",
            content: buildAnswer(trimmed, citations),
            citationsJson: JSON.stringify(citations)
          }
        ]
      }
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  return thread;
}

export async function getChatThread(threadId?: string | null) {
  if (!threadId) return null;
  const library = await getCurrentLibrary();

  return prisma.chatThread.findFirst({
    where: { id: threadId, libraryId: library.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });
}
