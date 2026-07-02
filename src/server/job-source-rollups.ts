import { isActiveJobStatus, isFailedJobStatus } from "./job-state.ts";

export type SourceJobRollup = {
  active: number;
  failed: number;
  sourceId: string;
  total: number;
};

type SourceRollupJob = {
  payloadJson: string;
  status: string;
};

function sourceIdFromPayload(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as { sourceId?: unknown };
    return typeof payload.sourceId === "string" && payload.sourceId.trim()
      ? payload.sourceId
      : null;
  } catch {
    return null;
  }
}

export function sourceJobRollupsFromJobs(jobs: SourceRollupJob[]) {
  const rollups = new Map<string, SourceJobRollup>();

  for (const job of jobs) {
    const active = isActiveJobStatus(job.status);
    const failed = isFailedJobStatus(job.status);
    if (!active && !failed) continue;

    const sourceId = sourceIdFromPayload(job.payloadJson);
    if (!sourceId) continue;

    const rollup = rollups.get(sourceId) ?? {
      active: 0,
      failed: 0,
      sourceId,
      total: 0
    };

    rollup.total += 1;
    if (active) rollup.active += 1;
    if (failed) rollup.failed += 1;
    rollups.set(sourceId, rollup);
  }

  return [...rollups.values()].sort((a, b) =>
    b.failed - a.failed ||
    b.active - a.active ||
    b.total - a.total ||
    a.sourceId.localeCompare(b.sourceId)
  );
}
