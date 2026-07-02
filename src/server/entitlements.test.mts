import assert from "node:assert/strict";
import test from "node:test";
import type { Account } from "@prisma/client";
import {
  canAddSourceForCount,
  canImportOpmlFeeds,
  canUploadPdfForLimit,
  DEFAULT_ENTITLEMENT_LIMITS
} from "./entitlement-limits.ts";

const account = { id: "account-test" } as Account;

test("source limits account for requested batch size", () => {
  assert.equal(canAddSourceForCount(8, { requestedSources: 2 }, 10).allowed, true);

  const result = canAddSourceForCount(9, { requestedSources: 2 }, 10);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "source_limit");
});

test("OPML imports are capped per request", () => {
  assert.equal(canImportOpmlFeeds(account, DEFAULT_ENTITLEMENT_LIMITS.maxOpmlFeedsPerImport).allowed, true);

  const result = canImportOpmlFeeds(account, DEFAULT_ENTITLEMENT_LIMITS.maxOpmlFeedsPerImport + 1);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "opml_limit");
});

test("PDF uploads reject files over the configured limit", () => {
  assert.equal(canUploadPdfForLimit(10, 10).allowed, true);

  const result = canUploadPdfForLimit(11, 10);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "pdf_size_limit");
});
