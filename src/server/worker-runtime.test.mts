import assert from "node:assert/strict";
import test from "node:test";
import { backgroundWorkRunsHere } from "./worker-runtime.ts";

test("production background work runs only in the designated worker", () => {
  assert.equal(backgroundWorkRunsHere({ NODE_ENV: "production" }), false);
  assert.equal(backgroundWorkRunsHere({ NODE_ENV: "production", CURIOFLOW_RUN_BACKGROUND_WORKER: "true" }), true);
  assert.equal(backgroundWorkRunsHere({ NODE_ENV: "development" }), true);
});
