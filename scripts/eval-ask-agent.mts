import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { libraryAgentSystemPrompt } from "../src/server/chat-agent-prompt.ts";
import { runAgentLoop, type AgentAction, type AgentObservation, type AgentToolResult } from "../src/server/chat-protocol.ts";

type EvalMessage = { role: "user" | "assistant"; content: string };
type ExpectedArguments = Record<string, string | number | boolean> & { queryIncludes?: string };
type EvalCase = {
  id: string;
  query: string;
  itemId?: string;
  conversation?: EvalMessage[];
  tags: string[];
  expected: {
    firstTool: Extract<AgentAction, { type: "tool" }>["tool"];
    arguments: ExpectedArguments;
    allowedTools?: Array<Extract<AgentAction, { type: "tool" }>["tool"]>;
    requiresCitations: boolean;
    answerIncludes?: string[];
  };
  offlineActions: AgentAction[];
};
type EvalSuite = { version: number; description: string; cases: EvalCase[] };

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const jsonOutput = argv.includes("--json");
const verbose = argv.includes("--verbose");
const caseFilter = optionValue("--case");
const baseUrl = optionValue("--base-url") ?? process.env.ASK_EVAL_BASE_URL ?? "http://127.0.0.1:1234/v1";
const model = optionValue("--model") ?? process.env.ASK_EVAL_MODEL ?? "qwen/qwen3-30b-a3b-2507";
const apiKey = process.env.ASK_EVAL_API_KEY?.trim();

function optionValue(name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function citation(itemId: string) {
  return { itemId, documentId: `document-${itemId}`, title: `Fixture ${itemId}`, source: "Fixture source", quote: "Grounded fixture evidence." };
}

function fixtureToolResult(action: Extract<AgentAction, { type: "tool" }>): AgentToolResult {
  if (action.tool === "get_library_stats") {
    const sourceType = typeof action.arguments.sourceType === "string" ? action.arguments.sourceType : "all";
    const stats = sourceType === "rss"
      ? { total: 688, saved: 8, inbox: 680, archived: 0, indexed: 688 }
      : sourceType === "pdf"
        ? { total: 3, saved: 3, inbox: 0, archived: 0, indexed: 3 }
        : { total: 700, saved: 20, inbox: 680, archived: 0, indexed: 700 };
    return {
      activity: { tool: action.tool, label: "Counted library items", detail: sourceType, resultCount: stats.total },
      citations: [],
      observation: { sourceType, ...stats }
    };
  }
  if (action.tool === "list_recent_items") {
    const citations = [citation("item-1"), citation("item-2")];
    return {
      activity: { tool: action.tool, label: "Reviewed recent items", detail: "2 saved items", resultCount: 2 },
      citations,
      observation: citations.map((entry) => ({ itemId: entry.itemId, title: entry.title, excerpt: entry.quote }))
    };
  }
  if (action.tool === "read_item") {
    const itemId = typeof action.arguments.itemId === "string" ? action.arguments.itemId : "item-1";
    const entry = citation(itemId);
    return {
      activity: { tool: action.tool, label: "Read item", detail: entry.title, resultCount: 1 },
      citations: [entry],
      observation: { itemId, title: entry.title, content: "Grounded fixture article content about design, AI, and faster iteration." }
    };
  }
  const query = typeof action.arguments.query === "string" ? action.arguments.query : "fixture query";
  const citations = query.includes("underwater") ? [] : [citation("item-1"), citation("item-2")];
  return {
    activity: { tool: action.tool, label: "Searched library", detail: query, resultCount: citations.length },
    citations,
    observation: citations.map((entry) => ({ itemId: entry.itemId, title: entry.title, passage: entry.quote }))
  };
}

async function completeLive(test: EvalCase, observations: AgentObservation[]) {
  const transcript = (test.conversation ?? []).map((message) => `${message.role}: ${message.content}`).join("\n");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: "system", content: libraryAgentSystemPrompt(test.itemId ?? null) },
        {
          role: "user",
          content: `Conversation:\n${transcript || "(new conversation)"}\n\nCurrent question: ${test.query}\n\nTool observations:\n${JSON.stringify(observations)}\n\nChoose the next tool or return the final answer.`
        }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`LLM returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM response did not contain message content");
  return content;
}

function argumentsMatch(actual: Record<string, unknown>, expected: ExpectedArguments) {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "queryIncludes") {
      if (typeof actual.query !== "string" || !actual.query.toLowerCase().includes(String(value).toLowerCase())) return false;
    } else if (actual[key] !== value) {
      return false;
    }
  }
  return true;
}

async function runCase(test: EvalCase) {
  const actions: Array<Extract<AgentAction, { type: "tool" }>> = [];
  const responses: string[] = [];
  let offlineIndex = 0;
  const result = await runAgentLoop({
    complete: async (observations) => {
      const response = live
        ? await completeLive(test, observations)
        : JSON.stringify(test.offlineActions[offlineIndex++] ?? {});
      responses.push(response);
      return response;
    },
    execute: async (action) => {
      actions.push(action);
      return fixtureToolResult(action);
    }
  });
  const failures: string[] = [];
  if (actions[0]?.tool !== test.expected.firstTool) failures.push(`first tool was ${actions[0]?.tool ?? "none"}, expected ${test.expected.firstTool}`);
  if (actions[0] && !argumentsMatch(actions[0].arguments, test.expected.arguments)) failures.push(`first tool arguments did not match ${JSON.stringify(test.expected.arguments)}`);
  if (test.expected.allowedTools) {
    const unexpected = actions.find((action) => !test.expected.allowedTools?.includes(action.tool));
    if (unexpected) failures.push(`unexpected tool ${unexpected.tool}`);
  }
  if (result.type !== "final") failures.push("agent did not produce a final answer within five steps");
  if (test.expected.requiresCitations && result.citations.length === 0) failures.push("final answer had no grounded citations");
  if (result.type === "final" && test.expected.answerIncludes) {
    const missing = test.expected.answerIncludes.filter((value) => !result.answer.includes(value));
    if (missing.length > 0) failures.push(`final answer did not include ${missing.join(", ")}`);
  }
  return { id: test.id, mode: live ? "live" : "offline", passed: failures.length === 0, failures, tools: actions.map((action) => action.tool), resultType: result.type, responses };
}

const suitePath = resolve("test/evals/ask-library.json");
const suite = JSON.parse(await readFile(suitePath, "utf8")) as EvalSuite;
const duplicateIds = suite.cases.filter((test, index) => suite.cases.findIndex((candidate) => candidate.id === test.id) !== index);
if (suite.version !== 1) throw new Error(`Unsupported eval suite version ${suite.version}`);
if (duplicateIds.length > 0) throw new Error(`Duplicate eval ids: ${duplicateIds.map((test) => test.id).join(", ")}`);
const selected = suite.cases.filter((test) => !caseFilter || test.id === caseFilter);
if (selected.length === 0) throw new Error(`No eval case matched ${caseFilter}`);

const results = [];
for (const test of selected) {
  try {
    results.push(await runCase(test));
  } catch (error) {
    results.push({ id: test.id, mode: live ? "live" : "offline", passed: false, failures: [error instanceof Error ? error.message : "Unknown eval failure"], tools: [], resultType: "error", responses: [] });
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ suite: suite.description, model: live ? model : null, results }, null, 2));
} else {
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} [${result.mode}] ${result.id}${result.tools.length ? ` · ${result.tools.join(" → ")}` : ""}`);
    result.failures.forEach((failure) => console.log(`  ${failure}`));
    if (verbose || !result.passed) result.responses.forEach((response, index) => console.log(`  model[${index + 1}]: ${response}`));
  }
  console.log(`\n${results.filter((result) => result.passed).length}/${results.length} Ask evals passed.`);
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
