import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyJobFailure,
  JOB_FAILURE_CATEGORIES
} from "./job-failure.ts";

test("classifies retry exhaustion failures", () => {
  assert.equal(
    classifyJobFailure(new Error("Job reached the maximum retry attempts.")),
    JOB_FAILURE_CATEGORIES.RETRY
  );
});

test("classifies entitlement and quota failures", () => {
  assert.equal(classifyJobFailure(new Error("Source limit reached for this plan")), JOB_FAILURE_CATEGORIES.ENTITLEMENT);
});

test("classifies timeout failures before generic network failures", () => {
  assert.equal(classifyJobFailure(new Error("URL fetch aborted after timeout")), JOB_FAILURE_CATEGORIES.TIMEOUT);
});

test("classifies provider failures before generic network failures", () => {
  assert.equal(classifyJobFailure(new Error("LLM request failed with HTTP 429")), JOB_FAILURE_CATEGORIES.PROVIDER);
});

test("classifies network failures", () => {
  assert.equal(classifyJobFailure(new Error("Podcast feed fetch failed with HTTP 500")), JOB_FAILURE_CATEGORIES.NETWORK);
});

test("classifies parser failures", () => {
  assert.equal(classifyJobFailure(new Error("PDF had no extractable text")), JOB_FAILURE_CATEGORIES.PARSER);
});
