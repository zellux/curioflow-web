import { fencedJobWhere, type JobLease } from "@/server/job-claim";
import { serializeJobProgress } from "@/server/job-progress";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { fetchSourceIdFromPayload } from "@/server/background-job-state";

// Also recognize jobs created before source_id was introduced, without rewriting history.
export async function activeSourceJob(sourceId: string, libraryId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      libraryId, type: "fetch_source", status: { in: ["queued", "running"] },
      OR: [{ sourceId }, { sourceId: null }]
    },
    orderBy: { createdAt: "asc" }
  });
  return jobs.find(job => job.sourceId === sourceId || fetchSourceIdFromPayload(job.payloadJson) === sourceId);
}

export async function enqueueSourceJob({ data }: {
  data: Prisma.JobUncheckedCreateInput & { sourceId: string; libraryId: string };
}) {
  const existing = await activeSourceJob(data.sourceId, data.libraryId);
  if (existing) return existing;
  try {
    return await prisma.job.create({ data });
  } catch (error) {
    // The partial unique index arbitrates simultaneous scheduler/manual requests.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await activeSourceJob(data.sourceId, data.libraryId);
      if (winner) return winner;
    }
    throw error;
  }
}

// A queued fetch must not reactivate a subscription removed while it was waiting.
export async function finishInactiveSourceJob(sourceId: string, libraryId: string, lease: JobLease) {
  const source = await prisma.source.findFirst({
    where: { id: sourceId, libraryId, type: "rss", status: { in: ["active", "error", "importing"] } }, select: { id: true }
  });
  if (source) return false;
  await prisma.job.updateMany({
    where: fencedJobWhere(lease),
    data: { status: "succeeded", finishedAt: new Date(), lockedUntil: null, leaseOwner: null, nextRunAt: null,
      progressJson: serializeJobProgress({ stage: "succeeded", outcome: "source_inactive" }) }
  });
  return true;
}
