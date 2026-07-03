const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 3_000;

type AttemptBucket = {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
};

const buckets = new Map<string, AttemptBucket>();

function nowMs() {
  return Date.now();
}

function bucketKey(kind: "identifier" | "ip", value: string) {
  return `${kind}:${value.trim().toLowerCase() || "unknown"}`;
}

function currentBucket(key: string, now = nowMs()) {
  const existing = buckets.get(key);
  if (!existing || now - existing.firstAttemptAt > WINDOW_MS) {
    const fresh = { count: 0, firstAttemptAt: now, lockedUntil: 0 };
    buckets.set(key, fresh);
    return fresh;
  }

  return existing;
}

function keysForAttempt(identifier: string, ipAddress: string | null | undefined) {
  return [
    bucketKey("identifier", identifier),
    bucketKey("ip", ipAddress || "unknown")
  ];
}

export function authThrottleStatus(identifier: string, ipAddress: string | null | undefined) {
  const now = nowMs();
  const lockedUntil = Math.max(
    ...keysForAttempt(identifier, ipAddress).map((key) => currentBucket(key, now).lockedUntil)
  );

  return {
    allowed: lockedUntil <= now,
    retryAfterSeconds: lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0
  };
}

export async function delayAfterFailedAuth(identifier: string, ipAddress: string | null | undefined) {
  const now = nowMs();
  let highestCount = 0;

  for (const key of keysForAttempt(identifier, ipAddress)) {
    const bucket = currentBucket(key, now);
    bucket.count += 1;
    highestCount = Math.max(highestCount, bucket.count);

    if (bucket.count >= MAX_FAILURES) {
      const lockMs = Math.min(WINDOW_MS, 2 ** (bucket.count - MAX_FAILURES) * 60_000);
      bucket.lockedUntil = now + lockMs;
    }
  }

  const delayMs = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, highestCount - 1));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function resetAuthThrottle(identifier: string, ipAddress: string | null | undefined) {
  for (const key of keysForAttempt(identifier, ipAddress)) {
    buckets.delete(key);
  }
}

export function requestIpAddress(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip") || null;
}
