import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { canCallTextLlm, completeTextWithLlm } from "@/server/llm";
import { getLlmRuntimeSettingsForAccount } from "@/server/settings";
import { runAgentLoop, type AgentAction, type ChatAgentStatus, type ChatCitation, type ChatMessageEvidence, type ChatToolActivity } from "@/server/chat-protocol";
import { libraryAgentSystemPrompt } from "@/server/chat-agent-prompt";

type ToolContext = {
  accountId: string;
  libraryId: string;
  itemId: string | null;
};

const MAX_TOOL_TEXT = 8_000;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "anything", "are", "does", "for", "from", "has", "how",
  "into", "library", "say", "that", "the", "their", "this", "what", "when", "where", "which", "with", "your"
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

function clip(text: string, length = 420) {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

function boundedInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function stringArgument(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceTypeArgument(value: unknown) {
  return value === "rss" || value === "pdf" || value === "podcast" || value === "url" ? value : null;
}

async function getLibraryStats(context: ToolContext, args: Record<string, unknown>) {
  const sourceType = sourceTypeArgument(args.sourceType);
  const sourceWhere = sourceType ? {
    OR: [
      { source: { type: sourceType } },
      { sourceEntries: { some: { source: { type: sourceType } } } }
    ]
  } : {};
  const baseWhere = { libraryId: context.libraryId, deletedAt: null, ...sourceWhere };
  const [total, saved, inbox, archived, indexed] = await Promise.all([
    prisma.item.count({ where: baseWhere }),
    prisma.item.count({ where: { ...baseWhere, savedToLibrary: true, archivedAt: null } }),
    prisma.item.count({ where: { ...baseWhere, savedToLibrary: false, archivedAt: null } }),
    prisma.item.count({ where: { ...baseWhere, archivedAt: { not: null } } }),
    prisma.item.count({ where: { ...baseWhere, documentId: { not: null } } })
  ]);
  const label = sourceType ? `${sourceType.toUpperCase()} items` : "Library items";
  return {
    activity: { tool: "get_library_stats", label: "Counted library items", detail: label, resultCount: total } as ChatToolActivity,
    citations: [] as ChatCitation[],
    observation: { sourceType: sourceType ?? "all", total, saved, inbox, archived, indexed }
  };
}

function itemWhere(context: ToolContext) {
  return {
    libraryId: context.libraryId,
    ...(context.itemId ? { id: context.itemId } : { savedToLibrary: true }),
    deletedAt: null,
    documentId: { not: null },
    document: { is: { OR: [{ ownerAccountId: null }, { ownerAccountId: context.accountId }] } }
  };
}

async function searchLibrary(context: ToolContext, args: Record<string, unknown>) {
  const query = stringArgument(args.query);
  const limit = boundedInteger(args.limit, 5, 8);
  if (!query) throw new Error("search_library requires a query");

  const items = await prisma.item.findMany({
    where: itemWhere(context),
    include: { source: true, document: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } } },
    take: 120
  });
  const queryTokens = tokenize(query);
  const scored = items
    .flatMap((item) => (item.document?.chunks ?? []).map((chunk) => ({
      item,
      chunk,
      score: scoreText(queryTokens, chunk.text) + scoreText(queryTokens, item.title) * 2 + scoreText(queryTokens, item.document?.title ?? "") * 2
    })))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, limit);
  const citations = scored.map<ChatCitation>((entry) => ({
    itemId: entry.item.id,
    documentId: entry.chunk.documentId,
    title: entry.item.title,
    source: entry.item.source?.name ?? "Library",
    quote: clip(entry.chunk.text)
  }));

  return {
    activity: { tool: "search_library", label: "Searched library", detail: query, resultCount: citations.length } as ChatToolActivity,
    citations,
    observation: citations.map((citation) => ({ itemId: citation.itemId, title: citation.title, source: citation.source, passage: citation.quote }))
  };
}

async function readItem(context: ToolContext, args: Record<string, unknown>) {
  const requestedItemId = stringArgument(args.itemId);
  if (!requestedItemId) throw new Error("read_item requires an itemId returned by another tool");
  if (context.itemId && requestedItemId !== context.itemId) throw new Error("This chat is limited to the open item");

  const item = await prisma.item.findFirst({
    where: { ...itemWhere(context), id: requestedItemId },
    include: { source: true, document: true }
  });
  if (!item?.document) throw new Error("Item is not available in this library");
  const citation: ChatCitation = {
    itemId: item.id,
    documentId: item.document.id,
    title: item.title,
    source: item.source?.name ?? "Library",
    quote: clip(item.document.text)
  };
  return {
    activity: { tool: "read_item", label: "Read item", detail: item.title, resultCount: 1 } as ChatToolActivity,
    citations: [citation],
    observation: {
      itemId: item.id,
      title: item.title,
      author: item.author,
      source: citation.source,
      publishedAt: item.publishedAt,
      content: item.document.text.slice(0, MAX_TOOL_TEXT)
    }
  };
}

async function listRecentItems(context: ToolContext, args: Record<string, unknown>) {
  const limit = boundedInteger(args.limit, 8, 20);
  const items = await prisma.item.findMany({
    where: itemWhere(context),
    include: { source: true, document: true },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const citations = items.map<ChatCitation>((item) => ({
    itemId: item.id,
    documentId: item.document?.id ?? "",
    title: item.title,
    source: item.source?.name ?? "Library",
    quote: clip(item.document?.text ?? item.title)
  }));
  return {
    activity: { tool: "list_recent_items", label: "Reviewed recent items", detail: `${items.length} saved items`, resultCount: items.length } as ChatToolActivity,
    citations,
    observation: items.map((item) => ({
      itemId: item.id,
      title: item.title,
      author: item.author,
      source: item.source?.name ?? "Library",
      type: item.type,
      publishedAt: item.publishedAt,
      savedAt: item.createdAt,
      excerpt: clip(item.document?.text ?? "", 240)
    }))
  };
}

async function executeTool(context: ToolContext, action: Extract<AgentAction, { type: "tool" }>) {
  if (action.tool === "get_library_stats") return getLibraryStats(context, action.arguments);
  if (action.tool === "search_library") return searchLibrary(context, action.arguments);
  if (action.tool === "read_item") return readItem(context, action.arguments);
  return listRecentItems(context, action.arguments);
}

function fallbackAnswer(question: string, citations: ChatCitation[]) {
  if (citations.length === 0) return `I couldn't find enough evidence in your saved library to answer “${question}.” Try a more specific topic or add more material.`;
  return `I found relevant evidence in ${citations.length} saved passage${citations.length === 1 ? "" : "s"}. The strongest match is from “${citations[0].title}”: ${citations[0].quote}`;
}

async function runAgent(context: ToolContext, question: string, conversation: Array<{ role: string; content: string }>) {
  const settings = await getLlmRuntimeSettingsForAccount(context.accountId);

  if (!canCallTextLlm(settings)) {
    const result = await searchLibrary(context, { query: question, limit: 4 });
    return {
      answer: fallbackAnswer(question, result.citations),
      citations: result.citations,
      activity: [result.activity],
      agent: { mode: "fallback", reason: "unavailable" } satisfies ChatAgentStatus
    };
  }

  const transcript = conversation.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n");
  let loopResult: Awaited<ReturnType<typeof runAgentLoop>>;
  try {
    loopResult = await runAgentLoop({
      complete: (observations) => completeTextWithLlm(settings, [
        { role: "system", content: libraryAgentSystemPrompt(context.itemId) },
        {
          role: "user",
          content: `Conversation:\n${transcript || "(new conversation)"}\n\nCurrent question: ${question}\n\nTool observations:\n${JSON.stringify(observations)}\n\nChoose the next tool or return the final answer.`
        }
      ], { maxTokens: 900, temperature: 0.1 }),
      execute: (action) => executeTool(context, action)
    });
  } catch (error) {
    console.error("Ask Library model request failed", error);
    const result = await searchLibrary(context, { query: question, limit: 4 });
    return {
      answer: fallbackAnswer(question, result.citations),
      citations: result.citations,
      activity: [result.activity],
      agent: { mode: "fallback", reason: "error" } satisfies ChatAgentStatus
    };
  }

  if (loopResult.type === "final") {
    return {
      answer: loopResult.answer,
      citations: loopResult.citations,
      activity: loopResult.activity,
      agent: { mode: "model", model: settings.model } satisfies ChatAgentStatus
    };
  }

  if (loopResult.activity.length === 0) {
    const result = await searchLibrary(context, { query: question, limit: 4 });
    return {
      answer: fallbackAnswer(question, result.citations),
      citations: result.citations,
      activity: [result.activity],
      agent: { mode: "fallback", reason: "incomplete" } satisfies ChatAgentStatus
    };
  }
  return {
    answer: fallbackAnswer(question, loopResult.citations),
    citations: loopResult.citations,
    activity: loopResult.activity,
    agent: { mode: "fallback", reason: "incomplete" } satisfies ChatAgentStatus
  };
}

export async function askLibrary(question: string, itemId?: string | null, threadId?: string | null) {
  const library = await getCurrentLibrary();
  const trimmed = question.trim();
  if (!trimmed) throw new Error("question is required");

  const existingThread = threadId ? await prisma.chatThread.findFirst({
    where: { id: threadId, libraryId: library.id },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  }) : null;
  if (threadId && !existingThread) throw new Error("Chat thread not found");
  if (existingThread?.itemId && itemId && existingThread.itemId !== itemId) throw new Error("Chat thread belongs to a different item");
  const scopedItemId = existingThread?.itemId ?? itemId ?? null;
  const result = await runAgent(
    { accountId: library.accountId, libraryId: library.id, itemId: scopedItemId },
    trimmed,
    existingThread?.messages.map((message) => ({ role: message.role, content: message.content })) ?? []
  );
  const evidenceJson = JSON.stringify({ citations: result.citations, activity: result.activity, agent: result.agent } satisfies ChatMessageEvidence);

  if (existingThread) {
    const userCreatedAt = new Date();
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
    await prisma.chatMessage.createMany({ data: [
      { threadId: existingThread.id, role: "user", content: trimmed, createdAt: userCreatedAt },
      { threadId: existingThread.id, role: "assistant", content: result.answer, citationsJson: evidenceJson, createdAt: assistantCreatedAt }
    ] });
    return getChatThread(existingThread.id);
  }

  const userCreatedAt = new Date();
  return prisma.chatThread.create({
    data: {
      libraryId: library.id,
      scope: scopedItemId ? "item" : "library",
      itemId: scopedItemId,
      title: trimmed.slice(0, 80),
      messages: { create: [
        { role: "user", content: trimmed, createdAt: userCreatedAt },
        { role: "assistant", content: result.answer, citationsJson: evidenceJson, createdAt: new Date(userCreatedAt.getTime() + 1) }
      ] }
    },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
}

export async function getChatThread(threadId?: string | null) {
  if (!threadId) return null;
  const library = await getCurrentLibrary();
  return prisma.chatThread.findFirst({
    where: { id: threadId, libraryId: library.id },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
}

export async function getChatThreads() {
  const library = await getCurrentLibrary();
  const threads = await prisma.chatThread.findMany({
    where: { libraryId: library.id },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return threads.sort((a, b) => {
    const aTime = a.messages[0]?.createdAt ?? a.createdAt;
    const bTime = b.messages[0]?.createdAt ?? b.createdAt;
    return bTime.getTime() - aTime.getTime();
  });
}

export async function deleteChatThread(threadId: string) {
  const library = await getCurrentLibrary();
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, libraryId: library.id },
    select: { id: true }
  });
  if (!thread) throw new Error("Chat thread not found");

  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { threadId: thread.id } }),
    prisma.chatThread.delete({ where: { id: thread.id } })
  ]);
}
