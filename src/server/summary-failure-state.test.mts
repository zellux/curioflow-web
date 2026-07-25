import assert from "node:assert/strict";
import test from "node:test";
import { failedArticleSummaryIds, hasFailedArticleSummary } from "./summary-failure-state.ts";

test("article summary failure is a current state rather than an attempt count", () => {
  assert.equal(hasFailedArticleSummary(JSON.stringify({ summaryStatus: "pending" })), false);
  assert.equal(hasFailedArticleSummary(JSON.stringify({ summaryStatus: "failed" })), true);
  assert.equal(hasFailedArticleSummary(JSON.stringify({ summaryStatus: "succeeded" })), false);
});

test("failed summary articles are counted once and non-articles are excluded", () => {
  const failedIds = failedArticleSummaryIds([
    {
      id: "article-1",
      type: "article",
      document: { metadataJson: JSON.stringify({ summaryStatus: "failed" }) }
    },
    {
      id: "article-2",
      type: "article",
      document: { metadataJson: JSON.stringify({ summaryStatus: "succeeded" }) }
    },
    {
      id: "pdf-1",
      type: "pdf",
      document: { metadataJson: JSON.stringify({ summaryStatus: "failed" }) }
    }
  ]);

  assert.deepEqual([...failedIds], ["article-1"]);
});
