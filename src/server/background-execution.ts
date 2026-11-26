import { backgroundWorkRunsHere } from "./worker-runtime.ts";

const activeJobs = new Set<string>();
// Jobs a reader is actively waiting on (e.g. translations). They bypass and do not consume shared capacity.
const interactiveJobs = new Set<string>();

export type BackgroundExecutionLane = "default" | "ingestion" | "interactive";

export function startBackgroundExecution(jobId: string, operation: () => Promise<void>, lane: BackgroundExecutionLane | boolean = "default") {
  const resolvedLane: BackgroundExecutionLane = lane === true ? "ingestion" : lane === false ? "default" : lane;
  if (!backgroundWorkRunsHere() || activeJobs.has(jobId) || interactiveJobs.has(jobId)) return false;
  if (resolvedLane !== "interactive") {
    const configured = Number(process.env.CURIOFLOW_BACKGROUND_CONCURRENCY ?? 3);
    const limit = Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : 3;
    if (activeJobs.size >= (resolvedLane === "ingestion" ? limit : Math.max(1, limit - 1))) return false;
  }
  const jobs = resolvedLane === "interactive" ? interactiveJobs : activeJobs;
  jobs.add(jobId);
  void Promise.resolve().then(operation).catch(error => {
    console.error("Curioflow background execution failed", error);
  }).finally(() => jobs.delete(jobId));
  return true;
}
