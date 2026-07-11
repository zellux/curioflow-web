import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentAction, parseChatMessageEvidence, runAgentLoop } from "./chat-protocol.ts";

test("agent protocol accepts bounded tool and final actions", () => {
  assert.deepEqual(parseAgentAction('{"type":"tool","tool":"search_library","arguments":{"query":"attention"}}'), {
    type: "tool",
    tool: "search_library",
    arguments: { query: "attention" }
  });
  assert.deepEqual(parseAgentAction('```json\n{"type":"final","answer":"Grounded answer","citedItemIds":["item-1",7]}\n```'), {
    type: "final",
    answer: "Grounded answer",
    citedItemIds: ["item-1"]
  });
  assert.equal(parseAgentAction('{"type":"tool","tool":"delete_item","arguments":{}}'), null);
});

test("chat evidence remains compatible with citation-only messages", () => {
  const citation = { itemId: "item-1", documentId: "doc-1", title: "Title", source: "Source", quote: "Quote" };
  assert.deepEqual(parseChatMessageEvidence(JSON.stringify([citation])), { citations: [citation], activity: [], agent: null });
  assert.deepEqual(parseChatMessageEvidence(JSON.stringify({ citations: [citation], activity: [{
    tool: "read_item",
    label: "Read item",
    detail: "Title",
    resultCount: 1
  }], agent: {
    mode: "model",
    model: "test-model"
  } })), {
    citations: [citation],
    activity: [{ tool: "read_item", label: "Read item", detail: "Title", resultCount: 1 }],
    agent: { mode: "model", model: "test-model" }
  });
  assert.deepEqual(parseChatMessageEvidence("not-json"), { citations: [], activity: [], agent: null });
});

test("agent loop executes a tool before returning grounded citations", async () => {
  const citation = { itemId: "item-1", documentId: "doc-1", title: "Attention", source: "Library", quote: "Evidence" };
  const responses = [
    '{"type":"tool","tool":"search_library","arguments":{"query":"attention"}}',
    '{"type":"final","answer":"Grounded answer","citedItemIds":["item-1","invented-item"]}'
  ];
  const seenObservations: unknown[] = [];
  const result = await runAgentLoop({
    complete: async (observations) => {
      seenObservations.push(structuredClone(observations));
      return responses.shift() ?? "";
    },
    execute: async (action) => {
      assert.equal(action.tool, "search_library");
      return {
        activity: { tool: "search_library", label: "Searched library", detail: "attention", resultCount: 1 },
        citations: [citation],
        observation: [{ itemId: "item-1", passage: "Evidence" }]
      };
    }
  });

  assert.equal(result.type, "final");
  assert.equal(result.answer, "Grounded answer");
  assert.deepEqual(result.citations, [citation]);
  assert.deepEqual(seenObservations[0], []);
  assert.deepEqual(seenObservations[1], [{ tool: "search_library", result: [{ itemId: "item-1", passage: "Evidence" }] }]);
});
