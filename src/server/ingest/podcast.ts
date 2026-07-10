import { Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { getCurrentLibrary } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  assertEntitlement,
  canTranscribePodcast,
  canTranscribePodcastAudioForLimit,
  maxPodcastTranscriptionBytes
} from "@/server/entitlements";
import { chunkText, normalizeUrl, sha256, titleFromUrl } from "@/server/ingest/articles";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { getLlmRuntimeSettingsForAccount } from "@/server/settings";
import {
  consumeManagedUsageInTransaction,
  releaseManagedUsage,
  reserveManagedUsage
} from "@/server/usage-reservations";
import { nextSourceFetchAt, sourceFailureNextFetchAt } from "@/server/source-schedule";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";
import { recordSourceEntry } from "@/server/source-entries";
import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import {
  fetchBytesWithPolicy,
  fetchJsonWithPolicy,
  fetchTextWithPolicy,
  llmAllowsPrivateNetwork
} from "@/server/outbound-http";

const PODCAST_TIMEOUT_MS = 10000;
const PODCAST_AUDIO_TIMEOUT_MS = 60000;
const MAX_PODCAST_FEED_BYTES = 5 * 1024 * 1024;
const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INITIAL_PODCAST_EPISODES = 12;

type PodcastEpisode = {
  entryKey: string;
  title: string;
  url: string;
  audioUrl: string;
  description: string | null;
  duration: string | null;
  publishedAt: Date | null;
};

type QueuedPodcastEpisode = Omit<PodcastEpisode, "publishedAt"> & {
  publishedAt: string | null;
};

type ParsedPodcast = {
  title: string;
  siteUrl: string | null;
  episodes: PodcastEpisode[];
};

type PodcastLlmResult = {
  text: string;
  usageReservationId?: string;
  metadata: {
    audioUrl: string;
    duration: string | null;
    transcriptStatus: string;
    transcriptError?: string;
    analysisStatus: string;
    analysisError?: string;
    llmProvider: string;
    llmModel: string;
    analyzedAt: string;
  };
};

type PodcastLlmSettings = Awaited<ReturnType<typeof getLlmRuntimeSettingsForAccount>>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result || null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record["#text"]) ?? text(record.text);
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function plainTextFromHtml(value: string | null) {
  if (!value) return null;
  const dom = new JSDOM(value);
  const result = dom.window.document.body.textContent?.replace(/\s+/g, " ").trim();
  return result || null;
}

async function fetchUrlText(
  url: string,
  validators: { httpEtag?: string | null; httpLastModified?: string | null } = {}
) {
  const headers: Record<string, string> = {
    accept: "application/rss+xml,application/xml,text/xml",
    "user-agent": "CurioflowBot/0.1 (+https://curioflow.net)"
  };
  if (validators.httpEtag) headers["if-none-match"] = validators.httpEtag;
  if (validators.httpLastModified) headers["if-modified-since"] = validators.httpLastModified;
  const response = await fetchTextWithPolicy(url, {
    acceptedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    ...(validators.httpEtag || validators.httpLastModified ? { acceptedStatuses: [304] } : {}),
    headers,
    maxBytes: MAX_PODCAST_FEED_BYTES,
    timeoutMs: PODCAST_TIMEOUT_MS
  });
  return {
    text: response.text,
    finalUrl: response.finalUrl,
    httpEtag: response.headers.get("etag"),
    httpLastModified: response.headers.get("last-modified"),
    status: response.status
  };
}

function enclosureUrl(value: unknown) {
  for (const candidate of asArray(value)) {
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const type = text(record.type)?.toLowerCase() ?? "";
      const url = text(record.url);
      if (url && (!type || type.startsWith("audio/"))) return url;
    }
  }

  return null;
}

function parsePodcastXml(xml: string, feedUrl: string): ParsedPodcast {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (!channel) throw new Error("Podcast feed must be an RSS feed");

  const title = text(channel.title) ?? new URL(feedUrl).hostname;
  const siteUrl = text(channel.link);
  const episodes = asArray(channel.item)
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const rawAudioUrl = enclosureUrl(item.enclosure);
      if (!rawAudioUrl) return null;

      const audioUrl = normalizeUrl(new URL(rawAudioUrl, feedUrl).toString());
      const rawUrl = text(item.link) ?? text(item.guid) ?? audioUrl;
      const url = normalizeUrl(new URL(rawUrl, feedUrl).toString());
      const title = text(item.title) ?? titleFromUrl(url);
      const description = plainTextFromHtml(text(item.description) ?? text(item.summary));

      return {
        entryKey: text(item.guid) ?? audioUrl,
        title,
        url,
        audioUrl,
        description,
        duration: text(item.duration),
        publishedAt: parseDate(item.pubDate) ?? parseDate(item.published) ?? parseDate(item.updated)
      };
    })
    .filter((episode): episode is PodcastEpisode => Boolean(episode));

  if (episodes.length === 0) {
    throw new Error("Podcast feed parsed successfully but had no audio episodes");
  }

  return { title, siteUrl, episodes };
}

function recentPodcastEpisodes(episodes: PodcastEpisode[]) {
  return episodes
    .map((episode, index) => ({ episode, index }))
    .sort((a, b) => {
      const aTime = a.episode.publishedAt?.getTime();
      const bTime = b.episode.publishedAt?.getTime();

      if (aTime !== undefined && bTime !== undefined && aTime !== bTime) {
        return bTime - aTime;
      }

      if (aTime !== undefined && bTime === undefined) return -1;
      if (aTime === undefined && bTime !== undefined) return 1;
      return a.index - b.index;
    })
    .slice(0, MAX_INITIAL_PODCAST_EPISODES)
    .map(({ episode }) => episode);
}

function queuedPodcastEpisode(episode: PodcastEpisode): QueuedPodcastEpisode {
  return {
    ...episode,
    publishedAt: episode.publishedAt?.toISOString() ?? null
  };
}

function podcastEpisodeFromJob(episode: QueuedPodcastEpisode): PodcastEpisode {
  return {
    ...episode,
    publishedAt: episode.publishedAt ? new Date(episode.publishedAt) : null
  };
}

async function fetchAndParsePodcast(
  inputUrl: string,
  validators: { httpEtag?: string | null; httpLastModified?: string | null } = {}
) {
  const fetched = await fetchUrlText(normalizeUrl(inputUrl), validators);
  const normalizedFeedUrl = normalizeUrl(fetched.finalUrl);
  if (fetched.status === 304) {
    return {
      normalizedFeedUrl,
      podcast: null,
      httpEtag: validators.httpEtag ?? null,
      httpLastModified: validators.httpLastModified ?? null,
      notModified: true
    };
  }
  return {
    normalizedFeedUrl,
    podcast: parsePodcastXml(fetched.text, normalizedFeedUrl),
    httpEtag: fetched.httpEtag,
    httpLastModified: fetched.httpLastModified,
    notModified: false
  };
}

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown LLM error";
}

function canCallLlm(settings: PodcastLlmSettings) {
  return settings.provider === "local" || Boolean(settings.apiKey);
}

function llmHeaders(settings: PodcastLlmSettings): Record<string, string> {
  return settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {};
}

async function transcribePodcastAudio(episode: PodcastEpisode, settings: PodcastLlmSettings) {
  if (!canCallLlm(settings)) return { status: "missing_llm_api_key" };

  const transcriptionLimit = maxPodcastTranscriptionBytes();
  const audioResponse = await fetchBytesWithPolicy(episode.audioUrl, {
    acceptedContentTypes: ["audio/", "application/octet-stream"],
    headers: { "user-agent": "CurioflowBot/0.1 (+https://curioflow.net)" },
    maxBytes: transcriptionLimit,
    timeoutMs: PODCAST_AUDIO_TIMEOUT_MS
  });
  const bytes = audioResponse.bytes;
  assertEntitlement(canTranscribePodcastAudioForLimit(bytes.byteLength, transcriptionLimit));

  const formData = new FormData();
  const audioBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audioBuffer).set(bytes);
  formData.append("model", "whisper-1");
  formData.append("file", new Blob([audioBuffer], { type: audioResponse.contentType || "audio/mpeg" }), "episode.mp3");

  const allowPrivateNetwork = await llmAllowsPrivateNetwork(settings.provider, settings.baseUrl);
  const body = await fetchJsonWithPolicy<{ text?: unknown }>(llmEndpoint(settings.baseUrl, "/audio/transcriptions"), {
    allowPrivateNetwork,
    method: "POST",
    headers: llmHeaders(settings),
    body: formData,
    maxBytes: MAX_LLM_RESPONSE_BYTES,
    timeoutMs: PODCAST_AUDIO_TIMEOUT_MS
  });
  const transcript = typeof body.text === "string" ? body.text.trim() : "";
  if (!transcript) throw new Error("Transcription response did not include text");

  return { status: "transcribed", transcript };
}

async function analyzePodcastText(input: {
  episode: PodcastEpisode;
  feedTitle: string;
  transcript: string;
  settings: PodcastLlmSettings;
}) {
  if (!canCallLlm(input.settings)) return { status: "missing_llm_api_key" };

  const allowPrivateNetwork = await llmAllowsPrivateNetwork(input.settings.provider, input.settings.baseUrl);
  const body = await fetchJsonWithPolicy<{
    choices?: Array<{ message?: { content?: unknown } }>;
  }>(llmEndpoint(input.settings.baseUrl, "/chat/completions"), {
    allowPrivateNetwork,
    method: "POST",
    headers: {
      ...llmHeaders(input.settings),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.settings.model,
      messages: [
        {
          role: "system",
          content:
            "You analyze podcast episodes for a personal knowledge base. Return concise sections: Summary, Key ideas, Questions to ask, and Connections to reading."
        },
        {
          role: "user",
          content: [
            `Podcast: ${input.feedTitle}`,
            `Episode: ${input.episode.title}`,
            `Description: ${input.episode.description ?? "No description"}`,
            "",
            "Transcript:",
            input.transcript.slice(0, 24000)
          ].join("\n")
        }
      ],
      temperature: 0.2
    }),
    maxBytes: MAX_LLM_RESPONSE_BYTES,
    timeoutMs: PODCAST_AUDIO_TIMEOUT_MS
  });
  const analysis = body.choices?.[0]?.message?.content;
  if (typeof analysis !== "string" || !analysis.trim()) {
    throw new Error("Analysis response did not include content");
  }

  return { status: "analyzed", analysis: analysis.trim() };
}

function fallbackPodcastContent(feedTitle: string, episode: PodcastEpisode) {
  const description = episode.description ?? "No episode description was provided by the feed.";
  const duration = episode.duration ? `Duration: ${episode.duration}` : "Duration: unknown";
  const transcript =
    "Transcript pending. Add an LLM API key in Settings, or wait for the podcast transcription worker to replace this placeholder.";
  const analysis = [
    `Summary: ${description}`,
    "",
    "Key ideas:",
    `- ${description.slice(0, 220)}`,
    "- Transcript and deeper takeaways will be regenerated when transcription succeeds.",
    "",
    "Questions to ask:",
    "- What is the episode mainly about?",
    "- Which saved articles connect to this episode?",
    "- What should I listen for first?"
  ].join("\n");
  return { description, duration, transcript, analysis, feedTitle };
}

function podcastDocumentText(input: {
  analysis: string;
  duration: string;
  episode: PodcastEpisode;
  feedTitle: string;
  transcript: string;
}) {
  return [
    input.episode.title,
    "",
    "Transcript",
    "",
    input.transcript,
    "",
    "Episode context",
    "",
    input.duration,
    `Podcast: ${input.feedTitle}`,
    `Audio: ${input.episode.audioUrl}`,
    "",
    "Analysis",
    "",
    input.analysis
  ].join("\n");
}

function queuedTranscriptDocument(feedTitle: string, episode: PodcastEpisode): PodcastLlmResult {
  const fallback = fallbackPodcastContent(feedTitle, episode);
  return {
    text: podcastDocumentText({ ...fallback, episode }),
    metadata: {
      audioUrl: episode.audioUrl,
      duration: episode.duration,
      transcriptStatus: "queued",
      analysisStatus: "queued",
      llmProvider: "pending",
      llmModel: "pending",
      analyzedAt: new Date().toISOString()
    }
  };
}

async function buildTranscriptDocument(
  accountId: string,
  feedTitle: string,
  episode: PodcastEpisode,
  usageIdempotencyKey: string
): Promise<PodcastLlmResult> {
  const [account, settings] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
    getLlmRuntimeSettingsForAccount(accountId)
  ]);
  const transcriptionEntitlement = canTranscribePodcast(account);
  const fallback = fallbackPodcastContent(feedTitle, episode);
  const llmAvailable = canCallLlm(settings);
  const llmReady = llmAvailable && transcriptionEntitlement.allowed;
  const usageReservation = llmReady
    ? await reserveManagedUsage({
        accountId,
        eventType: "podcast_transcription",
        idempotencyKey: usageIdempotencyKey
      })
    : null;
  const metadata: PodcastLlmResult["metadata"] = {
    audioUrl: episode.audioUrl,
    duration: episode.duration,
    transcriptStatus: llmReady ? "pending" : llmAvailable ? "disabled" : "missing_llm_api_key",
    analysisStatus: llmReady ? "pending" : llmAvailable ? "skipped" : "missing_llm_api_key",
    llmProvider: settings.provider,
    llmModel: settings.model,
    analyzedAt: new Date().toISOString()
  };

  if (!transcriptionEntitlement.allowed) {
    metadata.transcriptError = transcriptionEntitlement.reason;
    metadata.analysisError = transcriptionEntitlement.reason;
  }

  let transcript = fallback.transcript;
  let analysis = fallback.analysis;

  if (llmReady) {
    try {
      const transcription = await transcribePodcastAudio(episode, settings);
      if (!("transcript" in transcription) || !transcription.transcript) {
        throw new Error("Podcast transcription was unavailable");
      }
      transcript = transcription.transcript;
      metadata.transcriptStatus = transcription.status ?? "transcribed";
      const analysisResult = await analyzePodcastText({
        episode,
        feedTitle,
        transcript,
        settings
      });
      if (!("analysis" in analysisResult) || !analysisResult.analysis) {
        throw new Error("Podcast analysis was unavailable");
      }
      analysis = analysisResult.analysis;
      metadata.analysisStatus = analysisResult.status ?? "analyzed";
    } catch (error) {
      if (usageReservation) await releaseManagedUsage(usageReservation.id);
      throw error;
    }
  }

  const text = podcastDocumentText({ analysis, duration: fallback.duration, episode, feedTitle, transcript });

  return { text, metadata, usageReservationId: usageReservation?.id };
}

function podcastTranscriptionNeedsQueue(metadataJson: string) {
  try {
    const metadata = JSON.parse(metadataJson) as { transcriptStatus?: unknown };
    return metadata.transcriptStatus === "queued" || metadata.transcriptStatus === "pending";
  } catch {
    return false;
  }
}

async function queuePodcastTranscriptionJob(input: {
  contentObjectId: string;
  documentId: string;
  episode: PodcastEpisode;
  feedTitle: string;
  itemId: string;
  libraryId: string;
  sourceId: string;
}) {
  const existing = await prisma.job.findFirst({
    where: {
      contentObjectId: input.contentObjectId,
      type: BACKGROUND_JOB_TYPES.TRANSCRIBE_PODCAST,
      status: { in: ["queued", "running"] }
    }
  });
  if (existing) return existing;

  const data = {
    libraryId: input.libraryId,
    contentObjectId: input.contentObjectId,
    type: BACKGROUND_JOB_TYPES.TRANSCRIBE_PODCAST,
    status: "queued",
    progressJson: serializeJobProgress({
      stage: "queued",
      sourceId: input.sourceId,
      itemId: input.itemId
    }),
    payloadJson: JSON.stringify({
      sourceId: input.sourceId,
      itemId: input.itemId,
      documentId: input.documentId,
      feedTitle: input.feedTitle,
      episode: queuedPodcastEpisode(input.episode)
    })
  };

  try {
    return await prisma.job.create({ data });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return prisma.job.findFirstOrThrow({
      where: {
        contentObjectId: input.contentObjectId,
        type: BACKGROUND_JOB_TYPES.TRANSCRIBE_PODCAST,
        status: { in: ["queued", "running"] }
      }
    });
  }
}

async function savePodcastEpisodeToLibrary(input: {
  accountId: string;
  libraryId: string;
  sourceId: string;
  feedTitle: string;
  episode: PodcastEpisode;
}) {
  const canonicalKey = `podcast:${input.accountId}:${sha256(input.episode.audioUrl)}`;
  const contentObject = await prisma.contentObject.upsert({
    where: { canonicalKey },
    update: { lastSeenAt: new Date(), ownerAccountId: input.accountId },
    create: {
      canonicalKey,
      type: "podcast_episode",
      cacheScope: "account_private",
      ownerAccountId: input.accountId,
      normalizedUrl: input.episode.url,
      sourceFingerprint: sha256(input.episode.audioUrl),
      status: "pending"
    }
  });

  const existingItem = await prisma.item.findFirst({
    where: {
      libraryId: input.libraryId,
      contentObjectId: contentObject.id
    },
    include: { document: true }
  });
  if (existingItem) {
    await recordSourceEntry({
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      itemId: existingItem.id,
      entryKey: input.episode.entryKey,
      url: input.episode.url,
      title: input.episode.title,
      author: input.feedTitle,
      publishedAt: input.episode.publishedAt
    });
    if (existingItem.document && podcastTranscriptionNeedsQueue(existingItem.document.metadataJson)) {
      await queuePodcastTranscriptionJob({
        contentObjectId: contentObject.id,
        documentId: existingItem.document.id,
        episode: input.episode,
        feedTitle: input.feedTitle,
        itemId: existingItem.id,
        libraryId: input.libraryId,
        sourceId: input.sourceId
      });
    }
    return existingItem;
  }

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findFirst({
          where: {
            id: contentObject.latestDocumentId,
            OR: [{ ownerAccountId: null }, { ownerAccountId: input.accountId }]
          }
        })
      : null) ??
    (await prisma.document.findFirst({
      where: {
        contentObjectId: contentObject.id,
        OR: [{ ownerAccountId: null }, { ownerAccountId: input.accountId }]
      },
      orderBy: { createdAt: "desc" }
    }));

  if (existingDocument) {
    const item = await prisma.item.create({
      data: {
        libraryId: input.libraryId,
        sourceId: input.sourceId,
        contentObjectId: contentObject.id,
        documentId: existingDocument.id,
        type: "podcast",
        title: existingDocument.title ?? input.episode.title,
        url: input.episode.url,
        author: input.feedTitle,
        publishedAt: input.episode.publishedAt,
        status: "ready",
        savedToLibrary: false
      }
    });
    await recordSourceEntry({
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      itemId: item.id,
      entryKey: input.episode.entryKey,
      url: input.episode.url,
      title: input.episode.title,
      author: input.feedTitle,
      publishedAt: input.episode.publishedAt
    });
    return item;
  }

  const transcriptDocument = queuedTranscriptDocument(input.feedTitle, input.episode);
  const text = transcriptDocument.text;
  const document = await prisma.document.create({
    data: {
      contentObjectId: contentObject.id,
      ownerAccountId: input.accountId,
      contentType: "podcast_transcript",
      title: input.episode.title,
      text,
      contentHash: sha256(text),
      parserVersion: "llm-podcast-analysis-v1",
      language: "en",
      metadataJson: JSON.stringify(transcriptDocument.metadata)
    }
  });

  await prisma.documentChunk.createMany({
    data: chunkText(text).map((chunk, index) => ({
      documentId: document.id,
      chunkIndex: index,
      text: chunk,
      tokenCount: Math.ceil(chunk.length / 4),
      contentHash: sha256(chunk),
      embeddingModel: null,
      embeddingJson: null,
      metadataJson: JSON.stringify({ source: "podcast-transcript-placeholder" })
    }))
  });

  const item = await prisma.item.create({
    data: {
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      contentObjectId: contentObject.id,
      documentId: document.id,
      type: "podcast",
      title: input.episode.title,
      url: input.episode.url,
      author: input.feedTitle,
      publishedAt: input.episode.publishedAt,
      status: "ready",
      savedToLibrary: false
    }
  });
  await recordSourceEntry({
    libraryId: input.libraryId,
    sourceId: input.sourceId,
    itemId: item.id,
    entryKey: input.episode.entryKey,
    url: input.episode.url,
    title: input.episode.title,
    author: input.feedTitle,
    publishedAt: input.episode.publishedAt
  });

  await prisma.contentObject.update({
    where: { id: contentObject.id },
    data: {
      latestDocumentId: document.id,
      status: "ready"
    }
  });
  await queuePodcastTranscriptionJob({
    contentObjectId: contentObject.id,
    documentId: document.id,
    episode: input.episode,
    feedTitle: input.feedTitle,
    itemId: item.id,
    libraryId: input.libraryId,
    sourceId: input.sourceId
  });

  return item;
}

function podcastFailureMetadata(metadataJson: string, error: unknown, willRetry: boolean) {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  const status = willRetry ? "pending" : "failed";
  return JSON.stringify({
    ...metadata,
    transcriptStatus: status,
    transcriptError: errorMessage(error),
    analysisStatus: status,
    analysisError: errorMessage(error)
  });
}

export async function processPodcastTranscriptionJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { library: { select: { accountId: true } } }
  });
  if (!job?.libraryId || !job.library || job.type !== BACKGROUND_JOB_TYPES.TRANSCRIBE_PODCAST) {
    throw new Error("Podcast transcription job not found");
  }
  const payload = JSON.parse(job.payloadJson) as {
    documentId?: string;
    episode?: QueuedPodcastEpisode;
    feedTitle?: string;
    itemId?: string;
    sourceId?: string;
  };
  if (!payload.documentId || !payload.episode || !payload.feedTitle || !payload.itemId || !payload.sourceId) {
    throw new Error("Podcast transcription job payload is incomplete");
  }

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;
  const episode = podcastEpisodeFromJob(payload.episode);

  try {
    await updateJobProgress(job.id, {
      stage: "transcribing_audio",
      sourceId: payload.sourceId,
      itemId: payload.itemId
    }, claimed);
    const transcriptDocument = await buildTranscriptDocument(
      job.library.accountId,
      payload.feedTitle,
      episode,
      `podcast-job:${job.library.accountId}:${job.id}`
    );
    await updateJobProgress(job.id, {
      stage: "saving_transcript",
      sourceId: payload.sourceId,
      itemId: payload.itemId
    }, claimed);

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      const document = await tx.document.updateMany({
        where: { id: payload.documentId, ownerAccountId: job.library!.accountId },
        data: {
          text: transcriptDocument.text,
          contentHash: sha256(transcriptDocument.text),
          parserVersion: "llm-podcast-analysis-v2",
          metadataJson: JSON.stringify(transcriptDocument.metadata)
        }
      });
      if (document.count !== 1) throw new Error("Podcast transcript document is unavailable to this account");
      await tx.documentChunk.deleteMany({ where: { documentId: payload.documentId } });
      await tx.documentChunk.createMany({
        data: chunkText(transcriptDocument.text).map((chunk, index) => ({
          documentId: payload.documentId!,
          chunkIndex: index,
          text: chunk,
          tokenCount: Math.ceil(chunk.length / 4),
          contentHash: sha256(chunk),
          embeddingModel: null,
          embeddingJson: null,
          metadataJson: JSON.stringify({ source: "podcast-transcript" })
        }))
      });
      await tx.item.updateMany({
        where: { id: payload.itemId, libraryId: job.libraryId! },
        data: { documentId: payload.documentId, status: "ready" }
      });
      if (transcriptDocument.usageReservationId) {
        await consumeManagedUsageInTransaction(tx, transcriptDocument.usageReservationId);
      }
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          nextRunAt: null,
          progressJson: serializeJobProgress({
            stage: "succeeded",
            sourceId: payload.sourceId,
            itemId: payload.itemId,
            transcriptStatus: transcriptDocument.metadata.transcriptStatus,
            analysisStatus: transcriptDocument.metadata.analysisStatus
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
  } catch (error) {
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status === "ignored") return;
    const document = await prisma.document.findFirst({
      where: { id: payload.documentId, ownerAccountId: job.library.accountId },
      select: { metadataJson: true }
    });
    if (document) {
      await prisma.document.update({
        where: { id: payload.documentId },
        data: { metadataJson: podcastFailureMetadata(document.metadataJson, error, failure.status === "queued") }
      });
    }
  }
}

function startPodcastSourceJob(jobId: string) {
  if (!backgroundWorkRunsHere()) return;
  void processPodcastSourceJob(jobId).catch(async (error) => {
    await recordBackgroundJobFailure(jobId, error);
  });
}

export async function processPodcastSourceJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { library: { select: { accountId: true } } }
  });
  if (!job?.libraryId || !job.library) {
    throw new Error("Podcast source job not found");
  }

  const payload = JSON.parse(job.payloadJson) as {
    sourceId: string;
    feedUrl: string;
    feedTitle: string;
    episodes?: QueuedPodcastEpisode[];
  };
  let feedTitle = payload.feedTitle;
  let episodes = (payload.episodes ?? []).map(podcastEpisodeFromJob);
  let httpEtag: string | null | undefined;
  let httpLastModified: string | null | undefined;
  let refreshIntervalMinutes = 60;

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await updateJobProgress(job.id, {
      stage: payload.episodes ? "importing_episodes" : "fetching_feed",
      sourceId: payload.sourceId,
      feedUrl: payload.feedUrl,
      current: 0,
      total: episodes.length
    }, claimed);

    if (!payload.episodes) {
      const sourceState = await prisma.source.findFirst({
        where: { id: payload.sourceId, libraryId: job.libraryId },
        select: { httpEtag: true, httpLastModified: true, refreshIntervalMinutes: true }
      });
      if (!sourceState) throw new Error("Podcast source not found");
      refreshIntervalMinutes = sourceState.refreshIntervalMinutes;
      const fetched = await fetchAndParsePodcast(payload.feedUrl, sourceState);
      httpEtag = fetched.httpEtag;
      httpLastModified = fetched.httpLastModified;
      if (fetched.podcast) {
        feedTitle = fetched.podcast.title;
        episodes = recentPodcastEpisodes(fetched.podcast.episodes);
      } else {
        episodes = [];
      }
    }

    for (const [index, episode] of episodes.entries()) {
      await savePodcastEpisodeToLibrary({
        accountId: job.library.accountId,
        libraryId: job.libraryId,
        sourceId: payload.sourceId,
        feedTitle,
        episode
      });

      const current = index + 1;
      if (current === episodes.length || current % 5 === 0) {
        await updateJobProgress(job.id, {
          stage: "importing_episodes",
          sourceId: payload.sourceId,
          current,
          total: episodes.length,
          latestTitle: episode.title
        }, claimed);
      }
    }

    if (payload.episodes) {
      refreshIntervalMinutes = (await prisma.source.findUnique({
        where: { id: payload.sourceId },
        select: { refreshIntervalMinutes: true }
      }))?.refreshIntervalMinutes ?? 60;
    }
    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.source.update({
        where: { id: payload.sourceId },
        data: {
          status: "active",
          lastCheckedAt: new Date(),
          consecutiveFailures: 0,
          nextFetchAt: nextSourceFetchAt(refreshIntervalMinutes),
          ...(httpEtag !== undefined ? { httpEtag } : {}),
          ...(httpLastModified !== undefined ? { httpLastModified } : {})
        }
      });
      const completed = await tx.job.updateMany({
        where: fencedJobWhere(claimed),
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
          leaseOwner: null,
          nextRunAt: null,
          progressJson: serializeJobProgress({
            stage: "succeeded",
            sourceId: payload.sourceId,
            current: episodes.length,
            total: episodes.length
          }),
          payloadJson: JSON.stringify({
            ...payload,
            processedEpisodes: episodes.length
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });
  } catch (error) {
    const source = await prisma.source.findUnique({
      where: { id: payload.sourceId },
      select: { consecutiveFailures: true }
    });
    const consecutiveFailures = (source?.consecutiveFailures ?? 0) + 1;
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status === "ignored") return;
    await prisma.source.update({
        where: { id: payload.sourceId },
        data: {
          status: "error",
          consecutiveFailures: { increment: 1 },
          nextFetchAt: sourceFailureNextFetchAt(consecutiveFailures)
        }
      });
    return;
  }
}

export async function addPodcastSourceToCurrentLibrary(
  inputUrl: string,
  options: { refreshIntervalMinutes?: number } = {}
) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, podcast, httpEtag, httpLastModified } = await fetchAndParsePodcast(inputUrl);
  if (!podcast) throw new Error("Podcast source unexpectedly returned no content");
  const episodesToIndex = recentPodcastEpisodes(podcast.episodes);
  const refreshIntervalMinutes = options.refreshIntervalMinutes ?? 60;
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "podcast",
      url: normalizedFeedUrl
    }
  });

  let source =
    existingSource ??
    (await prisma.source.create({
      data: {
        libraryId: library.id,
        type: "podcast",
        name: podcast.title,
        url: normalizedFeedUrl,
        status: "active",
        lastCheckedAt: new Date(),
        refreshIntervalMinutes,
        httpEtag,
        httpLastModified
      }
    }));

  if (
    existingSource?.status === "unsubscribed"
    || existingSource?.name !== podcast.title
    || existingSource?.refreshIntervalMinutes !== refreshIntervalMinutes
    || existingSource?.httpEtag !== httpEtag
    || existingSource?.httpLastModified !== httpLastModified
  ) {
    source = await prisma.source.update({
      where: { id: source.id },
      data: {
        name: podcast.title,
        status: "active",
        lastCheckedAt: new Date(),
        refreshIntervalMinutes,
        httpEtag,
        httpLastModified
      }
    });
  }

  const job = await prisma.job.create({
    data: {
      libraryId: library.id,
      type: "fetch_source",
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        current: 0,
        total: episodesToIndex.length
      }),
      payloadJson: JSON.stringify({
        sourceId: source.id,
        feedUrl: normalizedFeedUrl,
        feedTitle: podcast.title,
        sourceFingerprint: sha256(`${normalizedFeedUrl}:${podcast.episodes.length}`),
        totalEpisodes: podcast.episodes.length,
        indexedEpisodes: episodesToIndex.length,
        indexLimit: MAX_INITIAL_PODCAST_EPISODES,
        episodes: episodesToIndex.map(queuedPodcastEpisode)
      })
    }
  });
  startPodcastSourceJob(job.id);

  return {
    source,
    items: await prisma.item.findMany({
      where: { libraryId: library.id, sourceEntries: { some: { sourceId: source.id } } },
      orderBy: { createdAt: "desc" }
    }),
    created: !existingSource
  };
}
