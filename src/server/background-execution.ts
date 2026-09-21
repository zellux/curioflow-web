import { backgroundWorkRunsHere } from "./worker-runtime.ts";

const activeJobs = new Set<string>();

export function startBackgroundExecution(jobId: string, operation: () => Promise<void>, ingestion = false) {
  const configured = Number(process.env.CURIOFLOW_BACKGROUND_CONCURRENCY ?? 3);
  const limit = Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : 3;
  if (!backgroundWorkRunsHere() || activeJobs.has(jobId) || activeJobs.size >= (ingestion ? limit : Math.max(1, limit - 1))) return false;
  activeJobs.add(jobId);
  void Promise.resolve().then(operation).catch(error => {
    console.error("Curioflow background execution failed", error);
  }).finally(() => activeJobs.delete(jobId));
  return true;
}
