export type WorkRevision = { activeJobIds: string[]; completedWorkVersion: string | null };

export function hasCompletedWork(previous: WorkRevision, next: WorkRevision) {
  const active = new Set(next.activeJobIds);
  return previous.completedWorkVersion !== next.completedWorkVersion
    || previous.activeJobIds.some(id => !active.has(id));
}
