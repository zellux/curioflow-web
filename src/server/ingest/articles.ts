import { createHash, type BinaryLike } from "node:crypto";
import { prisma } from "@/server/db";
import {
  ArticleExtractionError,
  extractArticleWithReadability,
  type ArticleExtraction
} from "@/server/ingest/extractors/article";
import { enqueueArticleSummaryGeneration } from "@/server/summaries";

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

export type SaveArticleItemInput = {
  libraryId: string;
  sourceId: string;
  url: string;
  title?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  jobType?: "ingest_url" | "fetch_source";
  allowDuplicateItem?: boolean;
  generateSummary?: boolean;
  savedToLibrary?: boolean;
};

type ArticleDocumentInput = {
  contentObjectId: string;
  extracted: ArticleExtraction;
};

export function sha256(value: BinaryLike) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUrl(input: string) {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
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

export function titleFromUrl(normalizedUrl: string) {
  const url = new URL(normalizedUrl);
  const lastPath = url.pathname.split("/").filter(Boolean).pop();
  if (!lastPath) return url.hostname;

  return decodeURIComponent(lastPath)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mockExtract(normalizedUrl: string, reason?: string): ArticleExtraction {
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
    publishedAt: null,
    language: "en",
    text,
    contentHtml: null,
    parserVersion: "mock-url-v1",
    metadata: {
      extractor: "mock",
      hostname: url.hostname,
      fetchedAt: new Date().toISOString(),
      fallbackReason: reason
    }
  };
}

async function extractArticle(normalizedUrl: string) {
  try {
    return await extractArticleWithReadability(normalizedUrl);
  } catch (error) {
    const reason =
      error instanceof ArticleExtractionError || error instanceof Error
        ? error.message
        : "Unknown extraction error";
    return mockExtract(normalizedUrl, reason);
  }
}

export function chunkText(text: string, targetChars = 700) {
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

function canReuseDocument(document: { parserVersion: string } | null) {
  return Boolean(document && document.parserVersion !== "mock-url-v1");
}

async function findReusableArticleDocument(contentObjectId: string) {
  return prisma.document.findFirst({
    where: {
      contentObjectId,
      parserVersion: {
        not: "mock-url-v1"
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

async function createArticleDocument({ contentObjectId, extracted }: ArticleDocumentInput) {
  const contentHash = sha256(extracted.text);
  const document = await prisma.document.create({
    data: {
      contentObjectId,
      contentType: "markdown",
      title: extracted.title,
      articleHtml: extracted.contentHtml,
      text: extracted.text,
      contentHash,
      parserVersion: extracted.parserVersion,
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
      metadataJson: JSON.stringify({ source: extracted.parserVersion })
    }))
  });

  return document;
}

export async function saveArticleItemToLibrary(input: SaveArticleItemInput) {
  const normalizedUrl = normalizeUrl(input.url);
  const urlHash = sha256(normalizedUrl);
  const canonicalKey = `url:${urlHash}`;
  const shouldGenerateSummary = input.generateSummary ?? true;

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

  if (!input.allowDuplicateItem) {
    const existingItem = await prisma.item.findFirst({
      where: {
        libraryId: input.libraryId,
        sourceId: input.sourceId,
        contentObjectId: contentObject.id
      }
    });

    if (existingItem) {
      if (input.savedToLibrary && !existingItem.savedToLibrary) {
        const item = await prisma.item.update({
          where: { id: existingItem.id },
          data: { savedToLibrary: true }
        });
        if (shouldGenerateSummary) {
          await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: item.id, includeUnsaved: true });
        }
        return item;
      }

      if (shouldGenerateSummary) {
        await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: existingItem.id, includeUnsaved: true });
      }

      return existingItem;
    }
  }

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findUnique({ where: { id: contentObject.latestDocumentId } })
      : null) ??
    (await prisma.document.findFirst({
      where: { contentObjectId: contentObject.id },
      orderBy: { createdAt: "desc" }
    }));

  const reusableDocument = canReuseDocument(existingDocument) ? existingDocument : null;
  const fallbackTitle = input.title?.trim() || titleFromUrl(normalizedUrl);

  const item = await prisma.item.create({
    data: {
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      contentObjectId: contentObject.id,
      documentId: reusableDocument?.id,
      type: "article",
      title: reusableDocument?.title ?? fallbackTitle,
      url: normalizedUrl,
      author: input.author ?? (reusableDocument ? new URL(normalizedUrl).hostname : null),
      publishedAt: input.publishedAt ?? null,
      status: reusableDocument ? "ready" : "pending",
      readStatus: "unread",
      savedToLibrary: input.savedToLibrary ?? true
    }
  });

  if (reusableDocument) {
    if (shouldGenerateSummary) {
      await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: item.id, includeUnsaved: true });
    }
    return item;
  }

  await prisma.job.create({
    data: {
      libraryId: input.libraryId,
      contentObjectId: contentObject.id,
      type: input.jobType ?? "ingest_url",
      status: "queued",
      payloadJson: JSON.stringify({ url: normalizedUrl, itemId: item.id, sourceId: input.sourceId })
    }
  });

  const extracted = await extractArticle(normalizedUrl);
  const document = await createArticleDocument({
    contentObjectId: contentObject.id,
    extracted: {
      ...extracted,
      title: extracted.title || fallbackTitle
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
    prisma.item.update({
      where: { id: item.id },
      data: {
        documentId: document.id,
        title: extracted.title || fallbackTitle,
        author: extracted.author ?? input.author,
        publishedAt: extracted.publishedAt ?? input.publishedAt ?? null,
        status: "ready"
      }
    }),
    prisma.job.updateMany({
      where: {
        contentObjectId: contentObject.id,
        type: input.jobType ?? "ingest_url",
        status: "queued"
      },
      data: {
        status: "succeeded",
        startedAt: new Date(),
        finishedAt: new Date()
      }
    })
  ]);

  const savedItem = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
  if (shouldGenerateSummary) {
    await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: savedItem.id, includeUnsaved: true });
  }
  return savedItem;
}

export async function refetchArticleItemContent(input: { libraryId: string; itemId: string }) {
  const item = await prisma.item.findFirst({
    where: {
      id: input.itemId,
      libraryId: input.libraryId
    },
    include: {
      contentObject: true
    }
  });

  if (!item) {
    throw new Error("Item not found");
  }

  if (item.type !== "article") {
    throw new Error("Only article items can be refetched");
  }

  const sourceUrl = item.contentObject?.normalizedUrl ?? item.url;
  if (!sourceUrl) {
    throw new Error("Article item has no URL to refetch");
  }

  const normalizedUrl = normalizeUrl(sourceUrl);
  const urlHash = sha256(normalizedUrl);
  const canonicalKey = `url:${urlHash}`;
  const contentObject =
    item.contentObject ??
    (await prisma.contentObject.upsert({
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
    }));

  const job = await prisma.job.create({
    data: {
      libraryId: input.libraryId,
      contentObjectId: contentObject.id,
      type: "refetch_article",
      status: "queued",
      payloadJson: JSON.stringify({ url: normalizedUrl, itemId: item.id })
    }
  });

  await prisma.$transaction([
    prisma.contentObject.update({
      where: { id: contentObject.id },
      data: {
        normalizedUrl,
        urlHash,
        status: "pending",
        lastSeenAt: new Date()
      }
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        contentObjectId: contentObject.id,
        status: "pending"
      }
    }),
    prisma.job.update({
      where: { id: job.id },
      data: { status: "running", startedAt: new Date() }
    })
  ]);

  try {
    const extracted = await extractArticle(normalizedUrl);
    const fallbackTitle = item.title || titleFromUrl(normalizedUrl);

    if (extracted.parserVersion === "mock-url-v1") {
      const reusableDocument = await findReusableArticleDocument(contentObject.id);
      if (reusableDocument) {
        await prisma.$transaction([
          prisma.contentObject.update({
            where: { id: contentObject.id },
            data: {
              latestDocumentId: reusableDocument.id,
              status: "ready"
            }
          }),
          prisma.item.update({
            where: { id: item.id },
            data: {
              documentId: reusableDocument.id,
              title: reusableDocument.title ?? fallbackTitle,
              author: item.author ?? new URL(normalizedUrl).hostname,
              publishedAt: item.publishedAt,
              status: "ready"
            }
          }),
          prisma.job.update({
            where: { id: job.id },
            data: {
              status: "succeeded",
              finishedAt: new Date(),
              error:
                typeof extracted.metadata.fallbackReason === "string"
                  ? `Refetch fell back to existing article: ${extracted.metadata.fallbackReason}`
                  : "Refetch fell back to existing article"
            }
          })
        ]);

        const savedItem = await prisma.item.findUniqueOrThrow({
          where: { id: item.id },
          include: { document: true }
        });
        if (savedItem.savedToLibrary) {
          await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: savedItem.id });
        }
        return savedItem;
      }
    }

    const document = await createArticleDocument({
      contentObjectId: contentObject.id,
      extracted: {
        ...extracted,
        title: extracted.title || fallbackTitle
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
      prisma.item.update({
        where: { id: item.id },
        data: {
          documentId: document.id,
          title: document.title ?? fallbackTitle,
          author: extracted.author ?? item.author,
          publishedAt: extracted.publishedAt ?? item.publishedAt,
          status: "ready"
        }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          finishedAt: new Date()
        }
      })
    ]);
  } catch (error) {
    await prisma.$transaction([
      prisma.contentObject.update({
        where: { id: contentObject.id },
        data: { status: "failed" }
      }),
      prisma.item.update({
        where: { id: item.id },
        data: { status: "failed" }
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : "Unable to refetch article content"
        }
      })
    ]);

    throw error;
  }

  const savedItem = await prisma.item.findUniqueOrThrow({
    where: { id: item.id },
    include: { document: true }
  });
  if (savedItem.savedToLibrary) {
    await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: savedItem.id });
  }
  return savedItem;
}
