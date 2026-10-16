import { JOB_FAILURE_CATEGORIES } from "./job-failure.ts";

export const TASK_FAILURE_TYPES = ["summary", "article_fetch", "other"] as const;
export type TaskFailureType = typeof TASK_FAILURE_TYPES[number];
export type TaskFailureFilter = "all" | TaskFailureType;

export function isTaskFailureType(value: unknown): value is TaskFailureType {
  return TASK_FAILURE_TYPES.some(type => type === value);
}

export function heartbeatHealth(lastSeenAt: Date | null, lastSuccessAt: Date | null, now = new Date()) {
  if (!lastSeenAt) return "unknown" as const;
  if (now.getTime() - lastSeenAt.getTime() > 90_000) return "offline" as const;
  if (!lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > 90_000) return "degraded" as const;
  return "online" as const;
}

export function safeTaskProgress(json: string) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(json) ?? {}; } catch { /* Older jobs may have no progress. */ }
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
  return {
    percent: typeof data.percent === "number" ? Math.min(100, number(data.percent) ?? 0) : null,
    failureCategory: Object.values(JOB_FAILURE_CATEGORIES).includes(data.failureCategory as never)
      ? String(data.failureCategory) : "unknown",
    outcome: ["blocked", "duplicate", "ingested", "quarantined", "rejected", "source_inactive"].includes(String(data.outcome))
      ? String(data.outcome) : null
  };
}
