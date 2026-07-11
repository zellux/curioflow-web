import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentAction, parseChatMessageEvidence } from "./chat-protocol.ts";

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
  assert.deepEqual(parseChatMessageEvidence(JSON.stringify([citation])), { citations: [citation], activity: [] });
  assert.deepEqual(parseChatMessageEvidence(JSON.stringify({ citations: [citation], activity: [{
    tool: "read_item",
    label: "Read item",
    detail: "Title",
    resultCount: 1
  }] })), {
    citations: [citation],
    activity: [{ tool: "read_item", label: "Read item", detail: "Title", resultCount: 1 }]
  });
  assert.deepEqual(parseChatMessageEvidence("not-json"), { citations: [], activity: [] });
});
