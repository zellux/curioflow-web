import { estimateLlmMessageTokens, llmInputTokenBudget, truncateTextToEstimatedTokens } from "./llm-input-budget.ts";
import type { AgentObservation } from "./chat-protocol.ts";

// Keep observations valid JSON and retain identifiers when shortening evidence.
function clipEvidence(value: unknown, tokens: number, key = ""): unknown {
  if (typeof value === "string" && ["content", "passage", "excerpt", "error"].includes(key)) {
    const clipped = truncateTextToEstimatedTokens(value, tokens);
    return clipped.length < value.length ? `${clipped}\n[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map(entry => clipEvidence(entry, tokens));
  if (value && typeof value === "object") {
    const entries = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, clipEvidence(entry, tokens, name)]));
    // An evidence page shortened to fit must resume at its visible end.
    if (typeof entries.content === "string" && typeof entries.offset === "number") {
      const visible = truncateTextToEstimatedTokens(entries.content, tokens);
      if (visible.length < entries.content.length) result.nextOffset = entries.offset + visible.length;
    }
    return result;
  }
  return value;
}

export function buildAskMessages(input: {
  system: string;
  question: string;
  conversation: Array<{ role: string; content: string }>;
  observations: AgentObservation[];
  contextWindow: number;
  reservedTokens: number;
}) {
  const budget = llmInputTokenBudget(input.contextWindow, input.reservedTokens);
  const history = [...input.conversation];
  const observations = [...input.observations];
  let evidence: unknown = observations;
  const messages = () => [
    { role: "system" as const, content: input.system },
    { role: "user" as const, content: `Conversation:\n${history.map(message => `${message.role}: ${message.content}`).join("\n") || "(new conversation)"}\n\nCurrent question: ${input.question}\n\nTool observations:\n${JSON.stringify(evidence)}\n\nChoose the next tool or return the final answer.` }
  ];
  while (estimateLlmMessageTokens(messages()) > budget && history.length) history.shift();
  while (estimateLlmMessageTokens(messages()) > budget && observations.length > 1) observations.shift();
  if (estimateLlmMessageTokens(messages()) > budget) {
    let low = 0;
    let high = budget;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      evidence = clipEvidence(observations, middle);
      if (estimateLlmMessageTokens(messages()) <= budget) low = middle;
      else high = middle - 1;
    }
    evidence = clipEvidence(observations, low);
  }
  const result = messages();
  if (estimateLlmMessageTokens(result) > budget) throw new Error("The question and required instructions exceed the context limit. Increase it in Settings or shorten the question.");
  return result;
}
