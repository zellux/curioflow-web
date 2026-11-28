import { createHmac, timingSafeEqual } from "node:crypto";
import { backgroundWorkRunsHere } from "./worker-runtime.ts";

export const WORKER_WAKE_HEADER = "x-curioflow-worker-wake";
const WORKER_WAKE_PURPOSE = "curioflow-internal-worker-wake-v1";
const WORKER_WAKE_TIMEOUT_MS = 2_000;
const DEFAULT_PRODUCTION_WORKER_URL = "http://worker:3001";

export type WorkerWakeHint = {
  jobId?: string;
  libraryId?: string;
  interactive?: boolean;
};

export function workerWakeToken(environment: Record<string, string | undefined> = process.env) {
  const secret = environment.CURIOFLOW_SECRET_KEY?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(WORKER_WAKE_PURPOSE).digest("base64url");
}

export function verifyWorkerWakeToken(
  provided: string | null | undefined,
  environment: Record<string, string | undefined> = process.env
) {
  const expected = workerWakeToken(environment);
  const candidate = provided?.trim();
  if (!expected || !candidate) return false;
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  if (expectedBuffer.byteLength !== candidateBuffer.byteLength) return false;
  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

export function workerWakeUrl(environment: Record<string, string | undefined> = process.env) {
  if (environment.CURIOFLOW_DISABLE_WORKER_WAKE === "true") return null;
  if (backgroundWorkRunsHere(environment)) return null;
  if (!workerWakeToken(environment)) return null;

  const configured = environment.CURIOFLOW_WORKER_URL?.trim();
  const base = configured || (environment.NODE_ENV === "production" ? DEFAULT_PRODUCTION_WORKER_URL : "");
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/api/internal/worker/wake`;
}

export function notifyBackgroundWorker(
  hint: WorkerWakeHint = {},
  options: {
    environment?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {}
) {
  const environment = options.environment ?? process.env;
  const url = workerWakeUrl(environment);
  const token = workerWakeToken(environment);
  if (!url || !token) return false;

  const fetchImpl = options.fetchImpl ?? fetch;
  void fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [WORKER_WAKE_HEADER]: token
    },
    body: JSON.stringify(hint),
    signal: AbortSignal.timeout(WORKER_WAKE_TIMEOUT_MS)
  }).catch(() => undefined);
  return true;
}
