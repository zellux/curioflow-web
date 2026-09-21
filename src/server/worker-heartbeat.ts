import { prisma } from "@/server/db";

export async function recordWorkerHeartbeat(id: "scheduler" | "newsletter", succeeded = false) {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { id },
    create: { id, lastSeenAt: now, lastSuccessAt: succeeded ? now : null },
    update: { lastSeenAt: now, ...(succeeded ? { lastSuccessAt: now } : {}) }
  });
}
