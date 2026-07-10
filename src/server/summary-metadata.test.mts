import assert from "node:assert/strict";
import test from "node:test";
import { readLlmSummaryFromMetadata } from "./summary-metadata.ts";

const metadata = JSON.stringify({
  summary: { overview: "Private summary", points: ["One"] },
  summaryAccountId: "account-a",
  summaryLanguage: "en",
  summarySource: "llm",
  summaryStatus: "succeeded"
});

test("account-owned summaries are hidden from other accounts", () => {
  assert.equal(readLlmSummaryFromMetadata(metadata, "account-b"), null);
  assert.equal(readLlmSummaryFromMetadata(metadata, "account-a")?.overview, "Private summary");
});
