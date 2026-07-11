export type ChatCitation = {
  itemId: string;
  documentId: string;
  title: string;
  source: string;
  quote: string;
};

export type ChatToolActivity = {
  tool: "get_library_stats" | "search_library" | "read_item" | "list_recent_items";
  label: string;
  detail: string;
  resultCount: number;
};

export type ChatMessageEvidence = {
  citations: ChatCitation[];
  activity: ChatToolActivity[];
  agent: ChatAgentStatus | null;
};

export type ChatAgentStatus = {
  mode: "model" | "fallback";
  model?: string;
  reason?: "unavailable" | "error" | "incomplete";
};

export type AgentAction =
  | { type: "tool"; tool: ChatToolActivity["tool"]; arguments: Record<string, unknown> }
  | { type: "final"; answer: string; citedItemIds?: string[] };

export type AgentToolResult = {
  activity: ChatToolActivity;
  citations: ChatCitation[];
  observation: unknown;
};

export type AgentObservation = { tool: string; arguments?: Record<string, unknown>; result: unknown };

export async function runAgentLoop({
  complete,
  execute,
  maxSteps = 5
}: {
  complete: (observations: AgentObservation[]) => Promise<string>;
  execute: (action: Extract<AgentAction, { type: "tool" }>) => Promise<AgentToolResult>;
  maxSteps?: number;
}) {
  const activity: ChatToolActivity[] = [];
  const evidence = new Map<string, ChatCitation>();
  const observations: AgentObservation[] = [];
  const executedCalls = new Set<string>();

  for (let step = 0; step < maxSteps; step += 1) {
    const action = parseAgentAction(await complete(observations));
    if (!action) {
      observations.push({ tool: "format_error", result: "Return one valid JSON action object." });
      continue;
    }
    if (action.type === "final") {
      if (activity.length === 0) {
        observations.push({ tool: "policy_error", result: "Use at least one tool before answering." });
        continue;
      }
      const citedIds = new Set(action.citedItemIds ?? []);
      const citations = [...evidence.values()].filter((citation) => citedIds.has(citation.itemId));
      return {
        type: "final" as const,
        answer: action.answer,
        citations: citations.length > 0 ? citations : [...evidence.values()].slice(0, 4),
        activity
      };
    }

    const callKey = JSON.stringify([action.tool, action.arguments]);
    if (executedCalls.has(callKey)) {
      observations.push({
        tool: "policy_error",
        result: `Do not repeat ${action.tool} with the same arguments. Use the existing observation or return a final answer.`
      });
      continue;
    }
    executedCalls.add(callKey);

    try {
      const result = await execute(action);
      result.citations.forEach((citation) => evidence.set(citation.itemId, citation));
      activity.push(result.activity);
      observations.push({ tool: action.tool, arguments: action.arguments, result: result.observation });
    } catch (error) {
      observations.push({ tool: action.tool, arguments: action.arguments, result: { error: error instanceof Error ? error.message : "Tool failed" } });
    }
  }

  return {
    type: "incomplete" as const,
    citations: [...evidence.values()].slice(0, 4),
    activity
  };
}

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
      (parsed.tool === "get_library_stats" || parsed.tool === "search_library" || parsed.tool === "read_item" || parsed.tool === "list_recent_items")
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
    if (Array.isArray(parsed)) return { citations: parsed as ChatCitation[], activity: [], agent: null };
    if (parsed && typeof parsed === "object") {
      const payload = parsed as Partial<ChatMessageEvidence>;
      return {
        citations: Array.isArray(payload.citations) ? payload.citations : [],
        activity: Array.isArray(payload.activity) ? payload.activity : [],
        agent: payload.agent?.mode === "model" || payload.agent?.mode === "fallback" ? payload.agent : null
      };
    }
  } catch {
    // Older or malformed messages simply have no attached evidence.
  }
  return { citations: [], activity: [], agent: null };
}
