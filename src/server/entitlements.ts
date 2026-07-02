import type { Account } from "@prisma/client";
import { prisma } from "@/server/db";
import { canAddSourceForCount, type EntitlementResult } from "@/server/entitlement-limits";

export {
  assertEntitlement,
  canAddSourceForCount,
  canGenerateBrief,
  canImportOpmlFeeds,
  canRunAsk,
  canTranscribePodcast,
  canTranscribePodcastAudioForLimit,
  canUploadPdf,
  canUploadPdfForLimit,
  DEFAULT_ENTITLEMENT_LIMITS,
  EntitlementDeniedError,
  maxOpmlFeedsPerImport,
  maxPdfUploadBytes,
  maxPodcastTranscriptionBytes,
  maxSources
} from "@/server/entitlement-limits";

type SourceLimitOptions = {
  requestedSources?: number;
};

export async function canAddSource(account: Account, options: SourceLimitOptions = {}): Promise<EntitlementResult> {
  const currentSources = await prisma.source.count({
    where: {
      library: { accountId: account.id },
      status: { not: "unsubscribed" },
      type: { in: ["rss", "podcast"] }
    }
  });

  return canAddSourceForCount(currentSources, options);
}
