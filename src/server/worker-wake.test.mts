import assert from "node:assert/strict";
import test from "node:test";
import {
  notifyBackgroundWorker,
  verifyWorkerWakeToken,
  WORKER_WAKE_HEADER,
  workerWakeToken,
  workerWakeUrl
} from "./worker-wake.ts";

test("worker wake token verifies matching secrets and rejects mismatched or empty values", () => {
  const env = { CURIOFLOW_SECRET_KEY: "super-secret-key" };
  const token = workerWakeToken(env);
  assert.ok(token);
  assert.equal(verifyWorkerWakeToken(token, env), true);
  assert.equal(verifyWorkerWakeToken(`${token}x`, env), false);
  assert.equal(verifyWorkerWakeToken(token, { CURIOFLOW_SECRET_KEY: "other-secret" }), false);
  assert.equal(verifyWorkerWakeToken(token, {}), false);
  assert.equal(verifyWorkerWakeToken(null, env), false);
});

test("worker wake URL resolves only when background work runs remotely", () => {
  assert.equal(workerWakeUrl({ NODE_ENV: "development", CURIOFLOW_SECRET_KEY: "secret" }), null);
  assert.equal(
    workerWakeUrl({ NODE_ENV: "production", CURIOFLOW_RUN_BACKGROUND_WORKER: "true", CURIOFLOW_SECRET_KEY: "secret" }),
    null
  );
  assert.equal(
    workerWakeUrl({ NODE_ENV: "production", CURIOFLOW_RUN_BACKGROUND_WORKER: "false" }),
    null
  );
  assert.equal(
    workerWakeUrl({ NODE_ENV: "production", CURIOFLOW_RUN_BACKGROUND_WORKER: "false", CURIOFLOW_SECRET_KEY: "secret" }),
    "http://worker:3001/api/internal/worker/wake"
  );
  assert.equal(
    workerWakeUrl({
      NODE_ENV: "development",
      CURIOFLOW_RUN_BACKGROUND_WORKER: "false",
      CURIOFLOW_SECRET_KEY: "secret",
      CURIOFLOW_WORKER_URL: "http://127.0.0.1:3001/"
    }),
    "http://127.0.0.1:3001/api/internal/worker/wake"
  );
  assert.equal(
    workerWakeUrl({
      NODE_ENV: "production",
      CURIOFLOW_RUN_BACKGROUND_WORKER: "false",
      CURIOFLOW_SECRET_KEY: "secret",
      CURIOFLOW_DISABLE_WORKER_WAKE: "true"
    }),
    null
  );
});

test("notifyBackgroundWorker posts signed wake hint to remote worker", async () => {
  const env = {
    NODE_ENV: "production",
    CURIOFLOW_RUN_BACKGROUND_WORKER: "false",
    CURIOFLOW_SECRET_KEY: "wake-secret"
  };
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const sent = notifyBackgroundWorker(
    { jobId: "job-123", libraryId: "lib-1", interactive: true },
    {
      environment: env,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    }
  );
  assert.equal(sent, true);
  assert.equal(capturedUrl, "http://worker:3001/api/internal/worker/wake");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(verifyWorkerWakeToken(headers[WORKER_WAKE_HEADER], env), true);
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    jobId: "job-123",
    libraryId: "lib-1",
    interactive: true
  });
});
