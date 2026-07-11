export type ChatCitation = {
  itemId: string;
  documentId: string;
  title: string;
  source: string;
  quote: string;
};

export type ChatToolActivity = {
  tool: "search_library" | "read_item" | "list_recent_items";
  label: string;
  detail: string;
  resultCount: number;
};

export type ChatMessageEvidence = {
  citations: ChatCitation[];
  activity: ChatToolActivity[];
};

export type AgentAction =
  | { type: "tool"; tool: ChatToolActivity["tool"]; arguments: Record<string, unknown> }
  | { type: "final"; answer: string; citedItemIds?: string[] };

export function parseAgentAction(value: string): AgentAction | null {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (parsed.type === "final" && typeof parsed.answer === "string" && parsed.answer.trim()) {
      return {
        type: "final",
        answer: parsed.answer.trim(),
        citedItemIds: Array.isArray(parsed.citedItemIds)
          ? parsed.citedItemIds.filter((id): id is string => typeof id === "string")
          : []
      };
    }
    if (
      parsed.type === "tool" &&
      (parsed.tool === "search_library" || parsed.tool === "read_item" || parsed.tool === "list_recent_items")
    ) {
      return {
        type: "tool",
        tool: parsed.tool,
        arguments: parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? parsed.arguments as Record<string, unknown>
          : {}
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseChatMessageEvidence(value: string): ChatMessageEvidence {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return { citations: parsed as ChatCitation[], activity: [] };
    if (parsed && typeof parsed === "object") {
      const payload = parsed as Partial<ChatMessageEvidence>;
      return {
        citations: Array.isArray(payload.citations) ? payload.citations : [],
        activity: Array.isArray(payload.activity) ? payload.activity : []
      };
    }
  } catch {
    // Older or malformed messages simply have no attached evidence.
  }
  return { citations: [], activity: [] };
}
