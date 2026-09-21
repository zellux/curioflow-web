import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { startBackgroundExecution } from "./background-execution.ts";

test("background capacity is shared across job types and released after completion", async () => {
  const worker = process.env.CURIOFLOW_RUN_BACKGROUND_WORKER;
  const concurrency = process.env.CURIOFLOW_BACKGROUND_CONCURRENCY;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
  process.env.CURIOFLOW_BACKGROUND_CONCURRENCY = "1";
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    assert.equal(startBackgroundExecution("rss", () => held), true);
    assert.equal(startBackgroundExecution("pdf", async () => { assert.fail("capacity exceeded"); }), false);
    assert.equal(startBackgroundExecution("rss", async () => { assert.fail("duplicate execution"); }), false);
    release();
    await setImmediate();
    let ran = false;
    assert.equal(startBackgroundExecution("summary", async () => { ran = true; }), true);
    await setImmediate();
    assert.equal(ran, true);
  } finally {
    release();
    if (worker === undefined) delete process.env.CURIOFLOW_RUN_BACKGROUND_WORKER;
    else process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = worker;
    if (concurrency === undefined) delete process.env.CURIOFLOW_BACKGROUND_CONCURRENCY;
    else process.env.CURIOFLOW_BACKGROUND_CONCURRENCY = concurrency;
  }
});

test("long processing jobs leave one slot available for subscription ingestion", async () => {
  const worker = process.env.CURIOFLOW_RUN_BACKGROUND_WORKER;
  const concurrency = process.env.CURIOFLOW_BACKGROUND_CONCURRENCY;
  process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "true";
  process.env.CURIOFLOW_BACKGROUND_CONCURRENCY = "3";
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    assert.equal(startBackgroundExecution("slow-pdf", () => held), true);
    assert.equal(startBackgroundExecution("slow-summary", () => held), true);
    assert.equal(startBackgroundExecution("another-summary", () => held), false);
    assert.equal(startBackgroundExecution("incoming-feed", () => held, true), true);
    assert.equal(startBackgroundExecution("another-feed", () => held, true), false);
  } finally {
    release();
    await setImmediate();
    if (worker === undefined) delete process.env.CURIOFLOW_RUN_BACKGROUND_WORKER;
    else process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = worker;
    if (concurrency === undefined) delete process.env.CURIOFLOW_BACKGROUND_CONCURRENCY;
    else process.env.CURIOFLOW_BACKGROUND_CONCURRENCY = concurrency;
  }
});
