import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid"
];

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUrl(input: string) {
  const url = new URL(input.trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }

  url.searchParams.sort();

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function titleFromUrl(normalizedUrl: string) {
  const url = new URL(normalizedUrl);
  const lastPath = url.pathname.split("/").filter(Boolean).pop();
  if (!lastPath) return url.hostname;

  return decodeURIComponent(lastPath)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mockExtract(normalizedUrl: string) {
  const url = new URL(normalizedUrl);
  const title = titleFromUrl(normalizedUrl);
  const text = [
    `${title}`,
    "",
    `This is a local mock extraction for ${url.hostname}. The MVP keeps the ingestion boundary intact: the item belongs to the library, while the readable document and chunks belong to a reusable content cache.`,
    "",
    "When real fetching is enabled, this parser can be replaced by a network extractor that stores the same document shape, updates the content object, and reuses cached chunks for duplicate saves.",
    "",
    `Original URL: ${normalizedUrl}`
  ].join("\n");

  return {
    title,
    author: url.hostname,
    language: "en",
    text,
    metadata: {
      extractor: "mock",
      hostname: url.hostname,
      fetchedAt: new Date().toISOString()
    }
  };
}

function chunkText(text: string, targetChars = 700) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && `${current}\n\n${paragraph}`.length > targetChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const normalizedUrl = normalizeUrl(inputUrl);
  const urlHash = sha256(normalizedUrl);
  const canonicalKey = `url:${urlHash}`;

  const source = await prisma.source.upsert({
    where: { id: "manual-url-source" },
    update: {},
    create: {
      id: "manual-url-source",
      libraryId: library.id,
      type: "url",
      name: "Saved URLs"
    }
  });

  const contentObject = await prisma.contentObject.upsert({
    where: { canonicalKey },
    update: { lastSeenAt: new Date() },
    create: {
      canonicalKey,
      type: "article",
      cacheScope: "public_web",
      normalizedUrl,
      urlHash,
      status: "pending"
    }
  });

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findUnique({ where: { id: contentObject.latestDocumentId } })
      : null) ??
    (await prisma.document.findFirst({
      where: { contentObjectId: contentObject.id },
      orderBy: { createdAt: "desc" }
    }));

  const item = await prisma.item.create({
    data: {
      libraryId: library.id,
      sourceId: source.id,
      contentObjectId: contentObject.id,
      documentId: existingDocument?.id,
      type: "article",
      title: existingDocument?.title ?? titleFromUrl(normalizedUrl),
      url: normalizedUrl,
      author: existingDocument ? new URL(normalizedUrl).hostname : null,
      status: existingDocument ? "ready" : "pending",
      readStatus: "unread"
    }
  });

  if (existingDocument) {
    return item;
  }

  await prisma.job.create({
    data: {
      libraryId: library.id,
      contentObjectId: contentObject.id,
      type: "ingest_url",
      status: "queued",
      payloadJson: JSON.stringify({ url: normalizedUrl, itemId: item.id })
    }
  });

  const extracted = mockExtract(normalizedUrl);
  const contentHash = sha256(extracted.text);

  const document = await prisma.document.create({
    data: {
      contentObjectId: contentObject.id,
      contentType: "markdown",
      title: extracted.title,
      text: extracted.text,
      contentHash,
      parserVersion: "mock-url-v1",
      language: extracted.language,
      metadataJson: JSON.stringify(extracted.metadata)
    }
  });

  await prisma.documentChunk.createMany({
    data: chunkText(extracted.text).map((chunk, index) => ({
      documentId: document.id,
      chunkIndex: index,
      text: chunk,
      tokenCount: Math.ceil(chunk.length / 4),
      contentHash: sha256(chunk),
      embeddingModel: null,
      embeddingJson: null,
      metadataJson: JSON.stringify({ source: "mock-url-v1" })
    }))
  });

  await prisma.$transaction([
    prisma.contentObject.update({
      where: { id: contentObject.id },
      data: {
        latestDocumentId: document.id,
        status: "ready"
      }
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        documentId: document.id,
        title: extracted.title,
        author: extracted.author,
        status: "ready"
      }
    }),
    prisma.job.updateMany({
      where: {
        contentObjectId: contentObject.id,
        type: "ingest_url",
        status: "queued"
      },
      data: {
        status: "succeeded",
        startedAt: new Date(),
        finishedAt: new Date()
      }
    })
  ]);

  return prisma.item.findUniqueOrThrow({ where: { id: item.id } });
}
