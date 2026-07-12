import assert from "node:assert/strict";
import test from "node:test";
import { managedUsageLimit } from "./usage-reservations.ts";

test("managed usage limits default high for self-hosted installations", () => {
  assert.equal(managedUsageLimit("summary_generation", {}), 1_000_000_000);
});

test("managed usage limits can be configured per event", () => {
  assert.equal(managedUsageLimit("summary_generation", { CURIOFLOW_MONTHLY_SUMMARY_GENERATION_LIMIT: "250" }), 250);
  assert.equal(managedUsageLimit("podcast_transcription", { CURIOFLOW_MONTHLY_PODCAST_TRANSCRIPTION_LIMIT: "bad" }), 1_000_000_000);
});
