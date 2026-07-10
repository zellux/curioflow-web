import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "./db.ts";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 3_000;
const MAX_BUCKETS = 50_000;
const PRUNE_BATCH_SIZE = 1_000;

function bucketKey(kind: "identifier" | "ip", value: string) {
  const normalized = `${kind}:${value.trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex");
}

function keysForAttempt(identifier: string, ipAddress: string | null | undefined) {
  return [
    bucketKey("identifier", identifier),
    ...(ipAddress ? [bucketKey("ip", ipAddress)] : [])
  ];
}

export async function authThrottleStatus(identifier: string, ipAddress: string | null | undefined) {
  const now = new Date();
  const keys = keysForAttempt(identifier, ipAddress);
  const buckets = await prisma.authThrottleBucket.findMany({
    where: {
      key: { in: keys },
      windowStartedAt: { gte: new Date(now.getTime() - WINDOW_MS) }
    },
    select: { lockedUntil: true }
  });
  const lockedUntil = buckets.reduce(
    (latest, bucket) => Math.max(latest, bucket.lockedUntil.getTime()),
    0
  );
  return {
    allowed: lockedUntil <= now.getTime(),
    retryAfterSeconds: lockedUntil > now.getTime()
      ? Math.ceil((lockedUntil - now.getTime()) / 1000)
      : 0
  };
}

export async function delayAfterFailedAuth(identifier: string, ipAddress: string | null | undefined) {
  const now = new Date();
  const expiredBefore = new Date(now.getTime() - WINDOW_MS);
  let highestCount = 0;

  for (const key of keysForAttempt(identifier, ipAddress)) {
    const bucket = await prisma.$transaction(async (tx) => {
      await tx.authThrottleBucket.deleteMany({
        where: { key, windowStartedAt: { lt: expiredBefore } }
      });
      const updated = await tx.authThrottleBucket.upsert({
        where: { key },
        create: { key, count: 1, windowStartedAt: now, lockedUntil: new Date(0) },
        update: { count: { increment: 1 } }
      });
      if (updated.count < MAX_FAILURES) return updated;

      const lockMs = Math.min(WINDOW_MS, 2 ** (updated.count - MAX_FAILURES) * 60_000);
      return tx.authThrottleBucket.update({
        where: { key },
        data: { lockedUntil: new Date(now.getTime() + lockMs) }
      });
    });
    highestCount = Math.max(highestCount, bucket.count);
  }

  await pruneAuthThrottleBuckets(expiredBefore);
  const delayMs = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, highestCount - 1));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function resetAuthThrottle(identifier: string, ipAddress: string | null | undefined) {
  await prisma.authThrottleBucket.deleteMany({
    where: { key: { in: keysForAttempt(identifier, ipAddress) } }
  });
}

async function pruneAuthThrottleBuckets(expiredBefore: Date) {
  await prisma.authThrottleBucket.deleteMany({
    where: { windowStartedAt: { lt: expiredBefore } }
  });
  const count = await prisma.authThrottleBucket.count();
  if (count <= MAX_BUCKETS) return;

  const oldest = await prisma.authThrottleBucket.findMany({
    orderBy: { updatedAt: "asc" },
    take: Math.min(PRUNE_BATCH_SIZE, count - MAX_BUCKETS),
    select: { key: true }
  });
  await prisma.authThrottleBucket.deleteMany({
    where: { key: { in: oldest.map((bucket) => bucket.key) } }
  });
}

export function requestIpAddress(headers: Headers) {
  if (process.env.CURIOFLOW_TRUST_PROXY_HEADERS !== "true") return null;
  const address = headers.get("x-real-ip")?.trim() ?? "";
  return isIP(address) ? address : null;
}
