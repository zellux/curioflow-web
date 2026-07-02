import { prisma } from "./db.ts";
import { JOB_STATUS } from "./job-state.ts";

type JobProgressValue = string | number | boolean | null;

export type JobProgressInput = {
  stage: string;
  current?: number | null;
  total?: number | null;
  message?: string | null;
  [key: string]: JobProgressValue | undefined;
};

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStage(stage: string) {
  const normalized = stage.trim();
  return normalized || "working";
}

export function buildJobProgress(input: JobProgressInput, now = new Date()) {
  const progress: Record<string, JobProgressValue> = {
    stage: normalizeStage(input.stage),
    updatedAt: now.toISOString()
  };

  for (const [key, value] of Object.entries(input)) {
    if (["stage", "current", "total", "percent", "updatedAt"].includes(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    progress[key] = value;
  }

  const total = finiteNumber(input.total);
  const current = finiteNumber(input.current);
  if (total !== null) progress.total = Math.max(0, total);
  if (current !== null) progress.current = Math.max(0, current);

  if (total !== null && total > 0 && current !== null) {
    const boundedCurrent = Math.min(Math.max(0, current), total);
    progress.percent = Math.round((boundedCurrent / total) * 100);
  }

  return progress;
}

export function serializeJobProgress(input: JobProgressInput, now = new Date()) {
  return JSON.stringify(buildJobProgress(input, now));
}

export async function updateJobProgress(jobId: string, input: JobProgressInput) {
  await prisma.job.updateMany({
    where: {
      id: jobId,
      status: JOB_STATUS.RUNNING
    },
    data: {
      progressJson: serializeJobProgress(input)
    }
  });
}
