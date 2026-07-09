import assert from "node:assert/strict";
import test from "node:test";
import { decodeFeedTextEntities } from "./ingest/feed-text.ts";

test("decodes feed text HTML entities", () => {
  assert.equal(decodeFeedTextEntities("Lil&#39;Log"), "Lil'Log");
  assert.equal(decodeFeedTextEntities("A &amp; B &quot;Today&quot;"), "A & B \"Today\"");
  assert.equal(decodeFeedTextEntities("Non-breaking&nbsp;space"), "Non-breaking space");
});

test("leaves unknown feed text entities intact", () => {
  assert.equal(decodeFeedTextEntities("Research &madeup; Notes"), "Research &madeup; Notes");
  assert.equal(decodeFeedTextEntities("Invalid &#999999999; codepoint"), "Invalid &#999999999; codepoint");
});
