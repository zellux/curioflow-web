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
import { claimQueuedJob } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { getLlmRuntimeSettingsForAccount } from "@/server/settings";
import { fetchBytesWithPolicy, fetchTextWithPolicy } from "@/server/outbound-http";

const PODCAST_TIMEOUT_MS = 10000;
const PODCAST_AUDIO_TIMEOUT_MS = 60000;
const MAX_PODCAST_FEED_BYTES = 5 * 1024 * 1024;
const MAX_INITIAL_PODCAST_EPISODES = 12;

type PodcastEpisode = {
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

async function fetchUrlText(url: string) {
  const response = await fetchTextWithPolicy(url, {
    acceptedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    headers: {
      accept: "application/rss+xml,application/xml,text/xml",
      "user-agent": "CurioflowBot/0.1 (+https://curioflow.net)"
    },
    maxBytes: MAX_PODCAST_FEED_BYTES,
    timeoutMs: PODCAST_TIMEOUT_MS
  });
  return { text: response.text, finalUrl: response.finalUrl };
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

async function fetchAndParsePodcast(inputUrl: string) {
  const fetched = await fetchUrlText(normalizeUrl(inputUrl));
  const normalizedFeedUrl = normalizeUrl(fetched.finalUrl);
  return { normalizedFeedUrl, podcast: parsePodcastXml(fetched.text, normalizedFeedUrl) };
}

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function llmHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-base-url";
  }
}

async function llmHttpError(response: Response, settings: PodcastLlmSettings, operation: string) {
  const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
  return new Error(
    `${operation} failed with HTTP ${response.status} (${settings.provider}/${settings.model} at ${llmHost(settings.baseUrl)})${body ? `: ${body}` : ""}`
  );
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

  const response = await fetch(llmEndpoint(settings.baseUrl, "/audio/transcriptions"), {
    method: "POST",
    headers: llmHeaders(settings),
    body: formData
  });

  if (!response.ok) {
    throw await llmHttpError(response, settings, "Transcription");
  }

  const body = (await response.json()) as { text?: unknown };
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

  const response = await fetch(llmEndpoint(input.settings.baseUrl, "/chat/completions"), {
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
    })
  });

  if (!response.ok) {
    throw await llmHttpError(response, input.settings, "Analysis");
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const analysis = body.choices?.[0]?.message?.content;
  if (typeof analysis !== "string" || !analysis.trim()) {
    throw new Error("Analysis response did not include content");
  }

  return { status: "analyzed", analysis: analysis.trim() };
}

async function buildTranscriptDocument(accountId: string, feedTitle: string, episode: PodcastEpisode): Promise<PodcastLlmResult> {
  const [account, settings] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
    getLlmRuntimeSettingsForAccount(accountId)
  ]);
  const transcriptionEntitlement = canTranscribePodcast(account);
  const description = episode.description ?? "No episode description was provided by the feed.";
  const duration = episode.duration ? `Duration: ${episode.duration}` : "Duration: unknown";
  const llmAvailable = canCallLlm(settings);
  const llmReady = llmAvailable && transcriptionEntitlement.allowed;
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

  let transcript =
    "Transcript pending. Add an LLM API key in Settings, or wait for the podcast transcription worker to replace this placeholder.";
  let analysis = [
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

  if (llmReady) {
    try {
      const transcription = await transcribePodcastAudio(episode, settings);
      if ("transcript" in transcription) {
        transcript = transcription.transcript ?? transcript;
        metadata.transcriptStatus = transcription.status ?? "transcribed";
      }
    } catch (error) {
      metadata.transcriptStatus = "failed";
      metadata.transcriptError = errorMessage(error);
    }

    try {
      const analysisResult = await analyzePodcastText({
        episode,
        feedTitle,
        transcript,
        settings
      });
      if ("analysis" in analysisResult) {
        analysis = analysisResult.analysis ?? analysis;
        metadata.analysisStatus = analysisResult.status ?? "analyzed";
      }
    } catch (error) {
      metadata.analysisStatus = "failed";
      metadata.analysisError = errorMessage(error);
    }
  }

  const text = [
    episode.title,
    "",
    "Transcript",
    "",
    transcript,
    "",
    "Episode context",
    "",
    `${duration}`,
    `Podcast: ${feedTitle}`,
    `Audio: ${episode.audioUrl}`,
    "",
    "Analysis",
    "",
    analysis
  ].join("\n");

  return { text, metadata };
}

async function savePodcastEpisodeToLibrary(input: {
  accountId: string;
  libraryId: string;
  sourceId: string;
  feedTitle: string;
  episode: PodcastEpisode;
}) {
  const canonicalKey = `podcast:${sha256(input.episode.audioUrl)}`;
  const contentObject = await prisma.contentObject.upsert({
    where: { canonicalKey },
    update: { lastSeenAt: new Date() },
    create: {
      canonicalKey,
      type: "podcast_episode",
      cacheScope: "public_web",
      normalizedUrl: input.episode.url,
      sourceFingerprint: sha256(input.episode.audioUrl),
      status: "pending"
    }
  });

  const existingItem = await prisma.item.findFirst({
    where: {
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      contentObjectId: contentObject.id
    }
  });
  if (existingItem) return existingItem;

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findUnique({ where: { id: contentObject.latestDocumentId } })
      : null) ??
    (await prisma.document.findFirst({
      where: { contentObjectId: contentObject.id },
      orderBy: { createdAt: "desc" }
    }));

  if (existingDocument) {
    return prisma.item.create({
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
  }

  const transcriptDocument = await buildTranscriptDocument(input.accountId, input.feedTitle, input.episode);
  const text = transcriptDocument.text;
  const document = await prisma.document.create({
    data: {
      contentObjectId: contentObject.id,
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

  await prisma.$transaction([
    prisma.contentObject.update({
      where: { id: contentObject.id },
      data: {
        latestDocumentId: document.id,
        status: "ready"
      }
    }),
    prisma.job.create({
      data: {
        libraryId: input.libraryId,
        contentObjectId: contentObject.id,
        type: "transcribe_podcast",
        status: "succeeded",
        progressJson: serializeJobProgress({
          stage: "succeeded",
          sourceId: input.sourceId,
          itemId: item.id,
          transcriptStatus: transcriptDocument.metadata.transcriptStatus,
          analysisStatus: transcriptDocument.metadata.analysisStatus
        }),
        payloadJson: JSON.stringify({
          sourceId: input.sourceId,
          itemId: item.id,
          audioUrl: input.episode.audioUrl,
          transcriptStatus: transcriptDocument.metadata.transcriptStatus,
          analysisStatus: transcriptDocument.metadata.analysisStatus
        }),
        startedAt: new Date(),
        finishedAt: new Date()
      }
    })
  ]);

  return item;
}

function startPodcastSourceJob(jobId: string) {
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
  const episodes = (payload.episodes ?? []).map(podcastEpisodeFromJob);

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await updateJobProgress(job.id, {
      stage: "importing_episodes",
      sourceId: payload.sourceId,
      feedUrl: payload.feedUrl,
      current: 0,
      total: episodes.length
    });

    for (const [index, episode] of episodes.entries()) {
      await savePodcastEpisodeToLibrary({
        accountId: job.library.accountId,
        libraryId: job.libraryId,
        sourceId: payload.sourceId,
        feedTitle: payload.feedTitle,
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
        });
      }
    }

    await prisma.$transaction([
      prisma.source.update({
        where: { id: payload.sourceId },
        data: {
          status: "active",
          lastCheckedAt: new Date()
        }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedUntil: null,
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
      })
    ]);
  } catch (error) {
    await prisma.$transaction([
      prisma.source.update({
        where: { id: payload.sourceId },
        data: { status: "error" }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: { lockedUntil: null }
      })
    ]);
    throw error;
  }
}

export async function addPodcastSourceToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, podcast } = await fetchAndParsePodcast(inputUrl);
  const episodesToIndex = recentPodcastEpisodes(podcast.episodes);
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
        lastCheckedAt: new Date()
      }
    }));

  if (existingSource?.status === "unsubscribed" || existingSource?.name !== podcast.title) {
    source = await prisma.source.update({
      where: { id: source.id },
      data: {
        name: podcast.title,
        status: "active",
        lastCheckedAt: new Date()
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
      where: { libraryId: library.id, sourceId: source.id },
      orderBy: { createdAt: "desc" }
    }),
    created: !existingSource
  };
}
