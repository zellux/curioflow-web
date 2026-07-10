import assert from "node:assert/strict";
import test from "node:test";
import type { Account } from "@prisma/client";
import {
  canAddSourceForCount,
  canGenerateBrief,
  canImportOpmlFeeds,
  canTranscribePodcast,
  canTranscribePodcastAudioForLimit,
  canUploadPdfForLimit,
  canUploadOpmlForLimit,
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

test("OPML uploads reject files over the configured byte limit", () => {
  assert.equal(canUploadOpmlForLimit(10, 10).allowed, true);
  assert.equal(canUploadOpmlForLimit(11, 10).allowed, false);
});

test("podcast transcription can be disabled by environment", () => {
  const previous = process.env.CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION;

  try {
    process.env.CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION = "false";
    const disabled = canTranscribePodcast(account);
    assert.equal(disabled.allowed, false);
    if (!disabled.allowed) assert.equal(disabled.code, "podcast_transcription_disabled");

    process.env.CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION = "true";
    assert.equal(canTranscribePodcast(account).allowed, true);
  } finally {
    if (previous === undefined) {
      delete process.env.CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION;
    } else {
      process.env.CURIOFLOW_ENABLE_PODCAST_TRANSCRIPTION = previous;
    }
  }
});

test("podcast transcription audio is capped", () => {
  assert.equal(canTranscribePodcastAudioForLimit(10, 10).allowed, true);

  const result = canTranscribePodcastAudioForLimit(11, 10);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "podcast_transcription_size_limit");
});

test("summary generation can be disabled by environment", () => {
  const previous = process.env.CURIOFLOW_ENABLE_SUMMARY_GENERATION;

  try {
    process.env.CURIOFLOW_ENABLE_SUMMARY_GENERATION = "false";
    const disabled = canGenerateBrief(account);
    assert.equal(disabled.allowed, false);
    if (!disabled.allowed) assert.equal(disabled.code, "summary_generation_disabled");

    process.env.CURIOFLOW_ENABLE_SUMMARY_GENERATION = "true";
    assert.equal(canGenerateBrief(account).allowed, true);
  } finally {
    if (previous === undefined) {
      delete process.env.CURIOFLOW_ENABLE_SUMMARY_GENERATION;
    } else {
      process.env.CURIOFLOW_ENABLE_SUMMARY_GENERATION = previous;
    }
  }
});
