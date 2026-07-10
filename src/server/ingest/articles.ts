import { createHash, type BinaryLike } from "node:crypto";
import { prisma } from "@/server/db";
import { documentForAccountReuse } from "@/server/document-isolation";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";
import { recordSourceEntry } from "@/server/source-entries";
import { isUniqueArticleItemForLibraryContentObjectError } from "@/server/ingest/article-dedupe";
import {
  ArticleExtractionError,
  extractArticleWithReadability,
  type ArticleExtraction
} from "@/server/ingest/extractors/article";
import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import { assertJobLease, assertJobLeaseUpdated, claimQueuedJob, fencedJobWhere } from "@/server/job-claim";
import { serializeJobProgress, updateJobProgress } from "@/server/job-progress";
import { recordBackgroundJobFailure } from "@/server/job-retry";
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
  sourceEntryKey?: string | null;
  url: string;
  title?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  generateSummary?: boolean;
  savedToLibrary?: boolean;
  startIngestJob?: boolean;
};

type ArticleDocumentInput = {
  contentObjectId: string;
  extracted: ArticleExtraction;
};

type ArticleJobPayload = {
  generateSummary?: boolean;
  includeUnsaved?: boolean;
  itemId?: string;
  sourceId?: string;
  url?: string;
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

function allowMockExtractionFallback() {
  return process.env.CURIOFLOW_ALLOW_MOCK_EXTRACTION === "true";
}

async function extractArticle(normalizedUrl: string) {
  try {
    return await extractArticleWithReadability(normalizedUrl);
  } catch (error) {
    const reason =
      error instanceof ArticleExtractionError || error instanceof Error
        ? error.message
        : "Unknown extraction error";
    if (!allowMockExtractionFallback()) {
      throw new ArticleExtractionError(reason);
    }
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

async function findExistingArticleItemForContentObject(libraryId: string, contentObjectId: string) {
  return prisma.item.findFirst({
    where: {
      libraryId,
      contentObjectId
    },
    orderBy: [
      { savedToLibrary: "desc" },
      { createdAt: "asc" }
    ]
  });
}

async function returnExistingArticleItem(
  input: SaveArticleItemInput,
  existingItem: NonNullable<Awaited<ReturnType<typeof findExistingArticleItemForContentObject>>>,
  options: { shouldGenerateSummary: boolean; targetSavedToLibrary: boolean }
) {
  const publishedAtUpdate = input.publishedAt && !existingItem.publishedAt ? { publishedAt: input.publishedAt } : {};

  if (options.targetSavedToLibrary && (existingItem.deletedAt || !existingItem.savedToLibrary || existingItem.archivedAt)) {
    const item = await prisma.item.update({
      where: { id: existingItem.id },
      data: { archivedAt: null, deletedAt: null, savedToLibrary: true, ...publishedAtUpdate }
    });
    if (options.shouldGenerateSummary) {
      await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: item.id, includeUnsaved: true });
    }
    return item;
  }

  if (Object.keys(publishedAtUpdate).length > 0) {
    const item = await prisma.item.update({
      where: { id: existingItem.id },
      data: publishedAtUpdate
    });
    if (options.shouldGenerateSummary) {
      await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: item.id, includeUnsaved: true });
    }
    return item;
  }

  if (options.shouldGenerateSummary) {
    await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: existingItem.id, includeUnsaved: true });
  }

  return existingItem;
}

function parseArticleJobPayload(payloadJson: string): ArticleJobPayload {
  try {
    const payload = JSON.parse(payloadJson) as ArticleJobPayload;
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function startArticleJob(jobId: string, processor: (jobId: string) => Promise<unknown>) {
  if (!backgroundWorkRunsHere()) return;
  void processor(jobId).catch(async (error) => {
    await recordBackgroundJobFailure(jobId, error);
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

export async function processArticleIngestJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.libraryId || !job.contentObjectId) {
    throw new Error("Article ingest job not found");
  }

  const payload = parseArticleJobPayload(job.payloadJson);
  if (!payload.itemId) {
    throw new Error("Article ingest job payload is missing an item id");
  }

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;
  const contentObjectId = job.contentObjectId;

  try {
    await updateJobProgress(job.id, {
      stage: "locating_item",
      itemId: payload.itemId
    }, claimed);

    const item = await prisma.item.findFirst({
      where: {
        id: payload.itemId,
        libraryId: job.libraryId
      },
      include: {
        contentObject: true
      }
    });

    if (!item) {
      throw new Error("Article ingest item not found");
    }

    const sourceUrl = payload.url ?? item.contentObject?.normalizedUrl ?? item.url;
    if (!sourceUrl) {
      throw new Error("Article ingest item has no URL");
    }

    const normalizedUrl = normalizeUrl(sourceUrl);
    const urlHash = sha256(normalizedUrl);
    const fallbackTitle = item.title || titleFromUrl(normalizedUrl);

    await updateJobProgress(job.id, {
      stage: "extracting_article",
      itemId: item.id,
      url: normalizedUrl
    }, claimed);

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.contentObject.update({
        where: { id: contentObjectId },
        data: {
          normalizedUrl,
          urlHash,
          status: "pending",
          lastSeenAt: new Date()
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          status: "pending",
          url: normalizedUrl
        }
      });
    });

    const extracted = await extractArticle(normalizedUrl);
    await updateJobProgress(job.id, {
      stage: "persisting_document",
      itemId: item.id,
      title: extracted.title || fallbackTitle
    }, claimed);

    const document = await createArticleDocument({
      contentObjectId,
      extracted: {
        ...extracted,
        title: extracted.title || fallbackTitle
      }
    });

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.contentObject.update({
        where: { id: contentObjectId },
        data: {
          latestDocumentId: document.id,
          status: "ready"
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          documentId: document.id,
          title: extracted.title || fallbackTitle,
          author: extracted.author ?? item.author,
          publishedAt: extracted.publishedAt ?? item.publishedAt ?? null,
          status: "ready"
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
            itemId: item.id,
            documentId: document.id,
            summaryQueued: payload.generateSummary !== false
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });

    if (payload.generateSummary !== false) {
      await enqueueArticleSummaryGeneration({
        libraryId: job.libraryId,
        itemId: item.id,
        includeUnsaved: payload.includeUnsaved ?? true
      });
    }
  } catch (error) {
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status === "ignored") return;
    await prisma.$transaction([
      prisma.contentObject.updateMany({
        where: { id: contentObjectId },
        data: { status: "failed" }
      }),
      prisma.item.updateMany({
        where: { id: payload.itemId, libraryId: job.libraryId },
        data: { status: "failed" }
      })
    ]);
    return;
  }
}

export async function processArticleRefetchJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.libraryId) {
    throw new Error("Article refetch job not found");
  }

  const payload = parseArticleJobPayload(job.payloadJson);
  if (!payload.itemId) {
    throw new Error("Article refetch job payload is missing an item id");
  }

  const item = await prisma.item.findFirst({
    where: {
      id: payload.itemId,
      libraryId: job.libraryId
    },
    include: {
      contentObject: true
    }
  });

  if (!item) {
    throw new Error("Article refetch item not found");
  }

  if (item.type !== "article") {
    throw new Error("Only article items can be refetched");
  }

  const sourceUrl = payload.url ?? item.contentObject?.normalizedUrl ?? item.url;
  if (!sourceUrl) {
    throw new Error("Article item has no URL to refetch");
  }

  const normalizedUrl = normalizeUrl(sourceUrl);
  const urlHash = sha256(normalizedUrl);
  const contentObjectId = job.contentObjectId ?? item.contentObjectId ?? item.contentObject?.id;
  if (!contentObjectId) {
    throw new Error("Article refetch job has no content object");
  }

  const claimed = await claimQueuedJob(job);
  if (!claimed) return;

  try {
    await updateJobProgress(job.id, {
      stage: "locating_item",
      itemId: payload.itemId
    }, claimed);

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.contentObject.update({
        where: { id: contentObjectId },
        data: {
          normalizedUrl,
          urlHash,
          status: "pending",
          lastSeenAt: new Date()
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          contentObjectId,
          status: "pending"
        }
      });
    });

    await updateJobProgress(job.id, {
      stage: "extracting_article",
      itemId: item.id,
      url: normalizedUrl
    }, claimed);

    const extracted = await extractArticle(normalizedUrl);
    const fallbackTitle = item.title || titleFromUrl(normalizedUrl);

    if (extracted.parserVersion === "mock-url-v1") {
      const reusableDocument = await findReusableArticleDocument(contentObjectId);
      if (reusableDocument) {
        await prisma.$transaction(async (tx) => {
          await assertJobLease(tx, claimed);
          await tx.contentObject.update({
            where: { id: contentObjectId },
            data: {
              latestDocumentId: reusableDocument.id,
              status: "ready"
            }
          });
          await tx.item.update({
            where: { id: item.id },
            data: {
              documentId: reusableDocument.id,
              title: reusableDocument.title ?? fallbackTitle,
              author: item.author ?? new URL(normalizedUrl).hostname,
              publishedAt: item.publishedAt,
              status: "ready"
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
                itemId: item.id,
                documentId: reusableDocument.id,
                reusedDocument: true
              }),
              error:
                typeof extracted.metadata.fallbackReason === "string"
                  ? `Refetch fell back to existing article: ${extracted.metadata.fallbackReason}`
                  : "Refetch fell back to existing article"
            }
          });
          assertJobLeaseUpdated(completed.count, claimed);
        });

        const savedItem = await prisma.item.findUniqueOrThrow({
          where: { id: item.id },
          include: { document: true }
        });
        if (savedItem.savedToLibrary) {
          await enqueueArticleSummaryGeneration({ libraryId: job.libraryId, itemId: savedItem.id });
        }
        return;
      }
    }

    await updateJobProgress(job.id, {
      stage: "persisting_document",
      itemId: item.id,
      title: extracted.title || fallbackTitle
    }, claimed);

    const document = await createArticleDocument({
      contentObjectId,
      extracted: {
        ...extracted,
        title: extracted.title || fallbackTitle
      }
    });

    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, claimed);
      await tx.contentObject.update({
        where: { id: contentObjectId },
        data: {
          latestDocumentId: document.id,
          status: "ready"
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          documentId: document.id,
          title: document.title ?? fallbackTitle,
          author: extracted.author ?? item.author,
          publishedAt: extracted.publishedAt ?? item.publishedAt,
          status: "ready"
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
            itemId: item.id,
            documentId: document.id
          })
        }
      });
      assertJobLeaseUpdated(completed.count, claimed);
    });

    const savedItem = await prisma.item.findUniqueOrThrow({
      where: { id: item.id },
      include: { document: true }
    });
    if (savedItem.savedToLibrary) {
      await enqueueArticleSummaryGeneration({ libraryId: job.libraryId, itemId: savedItem.id });
    }
  } catch (error) {
    const failure = await recordBackgroundJobFailure(job.id, error, claimed);
    if (failure.status === "ignored") return;
    await prisma.$transaction([
      prisma.contentObject.update({
        where: { id: contentObjectId },
        data: { status: "failed" }
      }),
      prisma.item.update({
        where: { id: item.id },
        data: { status: "failed" }
      })
    ]);
    return;
  }
}

export async function saveArticleItemToLibrary(input: SaveArticleItemInput) {
  const normalizedUrl = normalizeUrl(input.url);
  const urlHash = sha256(normalizedUrl);
  const canonicalKey = `url:${urlHash}`;
  const shouldGenerateSummary = input.generateSummary ?? true;
  const targetSavedToLibrary = input.savedToLibrary ?? true;

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

  const existingItem = await findExistingArticleItemForContentObject(input.libraryId, contentObject.id);

  if (existingItem) {
    await recordSourceEntry({
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      itemId: existingItem.id,
      entryKey: input.sourceEntryKey,
      url: normalizedUrl,
      title: input.title,
      author: input.author,
      publishedAt: input.publishedAt
    });
    return returnExistingArticleItem(input, existingItem, { shouldGenerateSummary, targetSavedToLibrary });
  }

  const existingDocument =
    (contentObject.latestDocumentId
      ? await prisma.document.findUnique({ where: { id: contentObject.latestDocumentId } })
      : null) ??
    (await prisma.document.findFirst({
      where: { contentObjectId: contentObject.id },
      orderBy: { createdAt: "desc" }
    }));

  const reusableCandidate = canReuseDocument(existingDocument) ? existingDocument : null;
  const targetLibrary = reusableCandidate
    ? await prisma.library.findUniqueOrThrow({ where: { id: input.libraryId }, select: { accountId: true } })
    : null;
  const reusableDocument = reusableCandidate && targetLibrary
    ? await documentForAccountReuse(reusableCandidate, targetLibrary.accountId)
    : null;
  const fallbackTitle = input.title?.trim() || titleFromUrl(normalizedUrl);

  let item;
  try {
    item = await prisma.item.create({
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
        savedToLibrary: targetSavedToLibrary
      }
    });
  } catch (error) {
    if (!isUniqueArticleItemForLibraryContentObjectError(error)) {
      throw error;
    }

    const duplicateItem = await findExistingArticleItemForContentObject(input.libraryId, contentObject.id);
    if (!duplicateItem) {
      throw error;
    }

    await recordSourceEntry({
      libraryId: input.libraryId,
      sourceId: input.sourceId,
      itemId: duplicateItem.id,
      entryKey: input.sourceEntryKey,
      url: normalizedUrl,
      title: input.title,
      author: input.author,
      publishedAt: input.publishedAt
    });
    return returnExistingArticleItem(input, duplicateItem, { shouldGenerateSummary, targetSavedToLibrary });
  }

  await recordSourceEntry({
    libraryId: input.libraryId,
    sourceId: input.sourceId,
    itemId: item.id,
    entryKey: input.sourceEntryKey,
    url: normalizedUrl,
    title: input.title,
    author: input.author,
    publishedAt: input.publishedAt
  });

  if (reusableDocument) {
    if (shouldGenerateSummary) {
      await enqueueArticleSummaryGeneration({ libraryId: input.libraryId, itemId: item.id, includeUnsaved: true });
    }
    return item;
  }

  const shouldStartIngestJob = input.startIngestJob ?? true;
  const job = await prisma.job.create({
    data: {
      libraryId: input.libraryId,
      contentObjectId: contentObject.id,
      type: BACKGROUND_JOB_TYPES.INGEST_URL,
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        itemId: item.id,
        sourceId: input.sourceId,
        url: normalizedUrl
      }),
      payloadJson: JSON.stringify({
        generateSummary: shouldGenerateSummary,
        includeUnsaved: true,
        url: normalizedUrl,
        itemId: item.id,
        sourceId: input.sourceId
      })
    }
  });

  if (shouldStartIngestJob) {
    startArticleJob(job.id, processArticleIngestJob);
  }
  return item;
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
      type: BACKGROUND_JOB_TYPES.REFETCH_ARTICLE,
      status: "queued",
      progressJson: serializeJobProgress({
        stage: "queued",
        itemId: item.id,
        url: normalizedUrl
      }),
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
    })
  ]);

  startArticleJob(job.id, processArticleRefetchJob);

  return prisma.item.findUniqueOrThrow({
    where: { id: item.id },
    include: { document: true }
  });
}
