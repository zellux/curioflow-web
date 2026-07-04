const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

type ResetBucket = {
  count: number;
  firstAttemptAt: number;
};

const buckets = new Map<string, ResetBucket>();

function bucketKey(kind: "identifier" | "ip", value: string | null | undefined) {
  return `${kind}:${(value || "unknown").trim().toLowerCase() || "unknown"}`;
}

function currentBucket(key: string, now: number) {
  const existing = buckets.get(key);
  if (!existing || now - existing.firstAttemptAt > WINDOW_MS) {
    const fresh = { count: 0, firstAttemptAt: now };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

export function allowPasswordResetRequest(identifier: string, ipAddress: string | null | undefined) {
  const now = Date.now();
  const keys = [
    bucketKey("identifier", identifier),
    bucketKey("ip", ipAddress)
  ];
  const bucketsForRequest = keys.map((key) => currentBucket(key, now));

  if (bucketsForRequest.some((bucket) => bucket.count >= MAX_ATTEMPTS)) {
    return false;
  }

  for (const bucket of bucketsForRequest) {
    bucket.count += 1;
  }

  return true;
}
