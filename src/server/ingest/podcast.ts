import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { getCurrentLibrary } from "@/server/auth";
import { prisma } from "@/server/db";
import { chunkText, normalizeUrl, sha256, titleFromUrl } from "@/server/ingest/articles";
import { getLlmSettingsForCurrentAccount } from "@/server/settings";

const PODCAST_TIMEOUT_MS = 10000;

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

function buildTranscriptDocument(feedTitle: string, episode: PodcastEpisode, llmSettings: Awaited<ReturnType<typeof getLlmSettingsForCurrentAccount>>) {
  const llmLine = llmSettings.hasApiKey
    ? `LLM analysis configured for ${llmSettings.provider} using ${llmSettings.model}.`
    : "LLM transcript is queued until an API key is added in Settings.";
  const description = episode.description ?? "No episode description was provided by the feed.";
  const duration = episode.duration ? `Duration: ${episode.duration}` : "Duration: unknown";

  return [
    episode.title,
    "",
    "Transcript",
    "",
    `${llmLine} This MVP stores a transcript placeholder so podcast episodes can already flow through the reader, chunks, Ask, and Digest surfaces. A real audio transcription worker can replace this document in the same content cache slot.`,
    "",
    "Episode context",
    "",
    `${duration}`,
    `Podcast: ${feedTitle}`,
    `Audio: ${episode.audioUrl}`,
    "",
    "Analysis",
    "",
    `Summary: ${description}`,
    "",
    "Key ideas:",
    `- ${description.slice(0, 220)}`,
    "- Transcript and deeper takeaways will be regenerated when the LLM/audio worker runs.",
    "",
    "Questions to ask:",
    "- What is the episode mainly about?",
    "- Which saved articles connect to this episode?",
    "- What should I listen for first?"
  ].join("\n");
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

  const llmSettings = await getLlmSettingsForCurrentAccount();
  const text = buildTranscriptDocument(input.feedTitle, input.episode, llmSettings);
  const document = await prisma.document.create({
    data: {
      contentObjectId: contentObject.id,
      contentType: "podcast_transcript",
      title: input.episode.title,
      text,
      contentHash: sha256(text),
      parserVersion: "llm-podcast-analysis-placeholder-v1",
      language: "en",
      metadataJson: JSON.stringify({
        audioUrl: input.episode.audioUrl,
        duration: input.episode.duration,
        transcriptStatus: llmSettings.hasApiKey ? "llm_configured_pending_worker" : "missing_llm_api_key",
        llmProvider: llmSettings.provider,
        llmModel: llmSettings.model,
        analyzedAt: new Date().toISOString()
      })
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
          transcriptStatus: llmSettings.hasApiKey ? "llm_configured_pending_worker" : "missing_llm_api_key"
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
