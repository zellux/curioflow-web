import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { getCurrentLibrary } from "@/server/auth";
import { prisma } from "@/server/db";
import { chunkText, normalizeUrl, sha256, titleFromUrl } from "@/server/ingest/articles";
import { getLlmRuntimeSettingsForCurrentAccount } from "@/server/settings";

const PODCAST_TIMEOUT_MS = 10000;
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

type PodcastEpisode = {
  title: string;
  url: string;
  audioUrl: string;
  description: string | null;
  duration: string | null;
  publishedAt: Date | null;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PODCAST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml,application/xml,text/xml,*/*;q=0.8",
        "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)"
      }
    });

    if (!response.ok) {
      throw new Error(`Podcast feed fetch failed with HTTP ${response.status}`);
    }

    return {
      text: await response.text(),
      finalUrl: response.url || url
    };
  } finally {
    clearTimeout(timeout);
  }
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

async function fetchAndParsePodcast(inputUrl: string) {
  const fetched = await fetchUrlText(normalizeUrl(inputUrl));
  const normalizedFeedUrl = normalizeUrl(fetched.finalUrl);
  return { normalizedFeedUrl, podcast: parsePodcastXml(fetched.text, normalizedFeedUrl) };
}

function llmEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown LLM error";
}

function canCallLlm(settings: Awaited<ReturnType<typeof getLlmRuntimeSettingsForCurrentAccount>>) {
  return settings.provider === "local" || Boolean(settings.apiKey);
}

function llmHeaders(settings: Awaited<ReturnType<typeof getLlmRuntimeSettingsForCurrentAccount>>): Record<string, string> {
  return settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {};
}

async function transcribePodcastAudio(episode: PodcastEpisode, settings: Awaited<ReturnType<typeof getLlmRuntimeSettingsForCurrentAccount>>) {
  if (!canCallLlm(settings)) return { status: "missing_llm_api_key" };

  const audioResponse = await fetch(episode.audioUrl, {
    headers: { "user-agent": "CurioflowBot/0.1 (+https://localhost; personal reader MVP)" }
  });
  if (!audioResponse.ok) {
    throw new Error(`Audio fetch failed with HTTP ${audioResponse.status}`);
  }

  const byteLength = Number(audioResponse.headers.get("content-length") ?? 0);
  if (byteLength > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("Audio file is larger than the MVP transcription limit");
  }

  const bytes = await audioResponse.arrayBuffer();
  if (bytes.byteLength > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("Audio file is larger than the MVP transcription limit");
  }

  const formData = new FormData();
  formData.append("model", "whisper-1");
  formData.append("file", new Blob([bytes], { type: audioResponse.headers.get("content-type") ?? "audio/mpeg" }), "episode.mp3");

  const response = await fetch(llmEndpoint(settings.baseUrl, "/audio/transcriptions"), {
    method: "POST",
    headers: llmHeaders(settings),
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Transcription failed with HTTP ${response.status}`);
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
  settings: Awaited<ReturnType<typeof getLlmRuntimeSettingsForCurrentAccount>>;
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
    throw new Error(`Analysis failed with HTTP ${response.status}`);
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

async function buildTranscriptDocument(feedTitle: string, episode: PodcastEpisode): Promise<PodcastLlmResult> {
  const settings = await getLlmRuntimeSettingsForCurrentAccount();
  const description = episode.description ?? "No episode description was provided by the feed.";
  const duration = episode.duration ? `Duration: ${episode.duration}` : "Duration: unknown";
  const metadata: PodcastLlmResult["metadata"] = {
    audioUrl: episode.audioUrl,
    duration: episode.duration,
    transcriptStatus: canCallLlm(settings) ? "pending" : "missing_llm_api_key",
    analysisStatus: canCallLlm(settings) ? "pending" : "missing_llm_api_key",
    llmProvider: settings.provider,
    llmModel: settings.model,
    analyzedAt: new Date().toISOString()
  };

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

  if (canCallLlm(settings)) {
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
        readStatus: "unread",
        savedToLibrary: false
      }
    });
  }

  const transcriptDocument = await buildTranscriptDocument(input.feedTitle, input.episode);
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
      readStatus: "unread",
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

export async function addPodcastSourceToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const { normalizedFeedUrl, podcast } = await fetchAndParsePodcast(inputUrl);
  const existingSource = await prisma.source.findFirst({
    where: {
      libraryId: library.id,
      type: "podcast",
      url: normalizedFeedUrl
    }
  });

  const source =
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
    await prisma.source.update({
      where: { id: source.id },
      data: {
        name: podcast.title,
        status: "active",
        lastCheckedAt: new Date()
      }
    });
  }

  const items = [];
  for (const episode of podcast.episodes.slice(0, 12)) {
    const item = await savePodcastEpisodeToLibrary({
      libraryId: library.id,
      sourceId: source.id,
      feedTitle: podcast.title,
      episode
    });
    items.push(item);
  }

  return { source, items, created: !existingSource };
}
