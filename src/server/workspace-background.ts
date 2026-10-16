import { prisma } from "@/server/db";
import { getBackgroundWorkStatusForLibrary } from "@/server/items";
import { decodeFeedTextEntities } from "@/server/ingest/feed-text";

export async function getWorkspaceBackgroundState(libraryId: string) {
  const [background, sources] = await Promise.all([
    getBackgroundWorkStatusForLibrary(libraryId),
    prisma.source.findMany({
      where: { libraryId, type: { not: "podcast" }, status: { not: "unsubscribed" } },
      select: { id: true, name: true, type: true, status: true }
    })
  ]);
  return {
    ...background,
    jobs: background.jobs.map(job => ({
      id: job.id, createdAt: job.createdAt.toISOString(), error: job.error,
      progressJson: job.progressJson, status: job.status, type: job.type
    })),
    sources: sources.map(source => ({ ...source, name: decodeFeedTextEntities(source.name) }))
  };
}

export type WorkspaceBackgroundState = Awaited<ReturnType<typeof getWorkspaceBackgroundState>>;
