export function nextSourceFetchAt(refreshIntervalMinutes: number, now = new Date(), jitter = Math.random()) {
  const intervalMs = Math.max(15, Math.min(24 * 60, refreshIntervalMinutes)) * 60_000;
  const jitterMultiplier = 0.9 + Math.max(0, Math.min(1, jitter)) * 0.2;
  return new Date(now.getTime() + intervalMs * jitterMultiplier);
}

export function sourceFailureNextFetchAt(consecutiveFailures: number, now = new Date()) {
  const delayMinutes = Math.min(6 * 60, 15 * 2 ** Math.max(0, consecutiveFailures - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}
