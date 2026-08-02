import { prisma } from "@/server/db";
import { chunkText, sha256 } from "@/server/ingest/articles";
import { sanitizeNewsletterContent } from "@/server/newsletter-content";
import {
  NEWSLETTER_IDENTITY_KIND,
  decideNewsletterGrouping,
  newsletterSourceName,
  normalizeNewsletterEmailAddress,
  normalizeNewsletterListId,
  type NewsletterGroupingSource
} from "@/server/newsletter-grouping";

export const NEWSLETTER_SOURCE_TYPE = "newsletter";
export const NEWSLETTER_ITEM_TYPE = "newsletter";

export type NewsletterVerdict = "fail" | "gray" | "pass" | "processing_failed" | "unknown";

export type InboundNewsletterMessage = {
  address: string;
  authenticatedDomain?: string | null;
  authenticatedFrom: boolean;
  dkimVerdict?: NewsletterVerdict;
  dmarcVerdict?: NewsletterVerdict;
  envelopeFrom?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  html?: string | null;
  listIdHeader?: string | null;
  messageId?: string | null;
  providerMessageId: string;
  rawStorageKey?: string | null;
  receivedAt: Date;
  spamVerdict?: NewsletterVerdict;
  spfVerdict?: NewsletterVerdict;
  subject?: string | null;
  text?: string | null;
  virusVerdict?: NewsletterVerdict;
  webVersionUrl?: string | null;
};

export type NewsletterIngestResult = {
  action: "blocked" | "duplicate" | "ingested" | "quarantined" | "rejected";
  inboundEmailId?: string;
  itemId?: string;
  sourceId?: string;
};

function normalizedVerdict(value: NewsletterVerdict | undefined) {
  return value ?? "unknown";
}

function normalizeMessageId(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return trimmed || null;
}

function safeWebVersionUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function groupingSources(rows: Array<{
  id: string;
  status: string;
  newsletterIdentities: Array<{ blockedAt: Date | null; kind: string; value: string }>;
}>): NewsletterGroupingSource[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    identities: row.newsletterIdentities.flatMap((identity) => (
      identity.kind === NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS || identity.kind === NEWSLETTER_IDENTITY_KIND.LIST_ID
        ? [{ blocked: Boolean(identity.blockedAt), kind: identity.kind, value: identity.value }]
        : []
    ))
  }));
}

async function recordTerminalInbound(input: {
  addressId: string;
  libraryId: string;
  message: InboundNewsletterMessage;
  sourceId?: string;
  status: "blocked" | "quarantined" | "rejected";
}) {
  return prisma.inboundEmail.create({
    data: {
      libraryId: input.libraryId,
      addressId: input.addressId,
      sourceId: input.sourceId,
      providerMessageId: input.message.providerMessageId,
      messageId: normalizeMessageId(input.message.messageId),
      envelopeFrom: normalizeNewsletterEmailAddress(input.message.envelopeFrom),
      fromAddress: normalizeNewsletterEmailAddress(input.message.fromAddress),
      fromName: input.message.fromName?.trim() || null,
      listId: normalizeNewsletterListId(input.message.listIdHeader),
      subject: input.message.subject?.trim() || "(No subject)",
      status: input.status,
      spfVerdict: normalizedVerdict(input.message.spfVerdict),
      dkimVerdict: normalizedVerdict(input.message.dkimVerdict),
      dmarcVerdict: normalizedVerdict(input.message.dmarcVerdict),
      spamVerdict: normalizedVerdict(input.message.spamVerdict),
      virusVerdict: normalizedVerdict(input.message.virusVerdict),
      rawStorageKey: input.message.rawStorageKey,
      receivedAt: input.message.receivedAt,
      processedAt: new Date()
    }
  });
}

export async function ingestNewsletterMessage(message: InboundNewsletterMessage): Promise<NewsletterIngestResult> {
  const addressValue = message.address.trim().toLowerCase();
  const address = await prisma.newsletterAddress.findFirst({
    where: { address: addressValue, status: "active" },
    include: { library: true }
  });
  if (!address) return { action: "rejected" };

  const normalizedMessageId = normalizeMessageId(message.messageId);
  const duplicate = await prisma.inboundEmail.findFirst({
    where: {
      addressId: address.id,
      OR: [
        { providerMessageId: message.providerMessageId },
        ...(normalizedMessageId ? [{ messageId: normalizedMessageId }] : [])
      ]
    }
  });
  if (duplicate) {
    return {
      action: "duplicate",
      inboundEmailId: duplicate.id,
      itemId: duplicate.itemId ?? undefined,
      sourceId: duplicate.sourceId ?? undefined
    };
  }

  if (message.virusVerdict === "fail") {
    const inbound = await recordTerminalInbound({
      addressId: address.id,
      libraryId: address.libraryId,
      message,
      status: "rejected"
    });
    return { action: "rejected", inboundEmailId: inbound.id };
  }

  if (message.spamVerdict === "fail") {
    const inbound = await recordTerminalInbound({
      addressId: address.id,
      libraryId: address.libraryId,
      message,
      status: "quarantined"
    });
    return { action: "quarantined", inboundEmailId: inbound.id };
  }

  const listId = normalizeNewsletterListId(message.listIdHeader);
  const fromAddress = normalizeNewsletterEmailAddress(message.fromAddress);
  const identityValues = [listId, fromAddress].filter((value): value is string => Boolean(value));
  const candidateRows = identityValues.length > 0
    ? await prisma.source.findMany({
        where: {
          libraryId: address.libraryId,
          type: NEWSLETTER_SOURCE_TYPE,
          newsletterIdentities: { some: { value: { in: identityValues } } }
        },
        include: { newsletterIdentities: true }
      })
    : [];
  const decision = decideNewsletterGrouping({
    authenticatedFrom: message.authenticatedFrom,
    fromAddress,
    listId
  }, groupingSources(candidateRows));

  if (decision.action === "blocked") {
    const inbound = await recordTerminalInbound({
      addressId: address.id,
      libraryId: address.libraryId,
      message,
      sourceId: decision.sourceId,
      status: "blocked"
    });
    return { action: "blocked", inboundEmailId: inbound.id, sourceId: decision.sourceId };
  }

  const content = sanitizeNewsletterContent(message);
  const subject = message.subject?.trim() || "(No subject)";
  const contentText = content.text || subject;
  const sourceName = newsletterSourceName({
    fromAddress,
    fromName: message.fromName,
    listIdHeader: message.listIdHeader
  });
  const canonicalKey = `newsletter:${address.accountId}:${sha256(message.providerMessageId)}`;
  const entryKey = normalizedMessageId ?? message.providerMessageId;
  const webVersionUrl = safeWebVersionUrl(message.webVersionUrl);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const source = decision.action === "match"
      ? await tx.source.update({
          where: { id: decision.sourceId },
          data: decision.promote ? { status: "active" } : {}
        })
      : await tx.source.create({
          data: {
            libraryId: address.libraryId,
            type: NEWSLETTER_SOURCE_TYPE,
            name: sourceName,
            status: listId && message.authenticatedFrom ? "active" : "provisional"
          }
        });

    if (listId && message.authenticatedFrom) {
      await tx.newsletterIdentity.upsert({
        where: { sourceId_kind_value: { sourceId: source.id, kind: NEWSLETTER_IDENTITY_KIND.LIST_ID, value: listId } },
        update: { lastSeenAt: now, authenticatedDomain: message.authenticatedDomain?.toLowerCase() || null, confidence: "high" },
        create: {
          libraryId: address.libraryId,
          sourceId: source.id,
          kind: NEWSLETTER_IDENTITY_KIND.LIST_ID,
          value: listId,
          authenticatedDomain: message.authenticatedDomain?.toLowerCase() || null,
          confidence: "high"
        }
      });
    }

    if (fromAddress && message.authenticatedFrom) {
      await tx.newsletterIdentity.upsert({
        where: { sourceId_kind_value: { sourceId: source.id, kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, value: fromAddress } },
        update: { lastSeenAt: now, authenticatedDomain: message.authenticatedDomain?.toLowerCase() || null },
        create: {
          libraryId: address.libraryId,
          sourceId: source.id,
          kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS,
          value: fromAddress,
          authenticatedDomain: message.authenticatedDomain?.toLowerCase() || null,
          confidence: "medium"
        }
      });
    }

    const contentObject = await tx.contentObject.create({
      data: {
        canonicalKey,
        type: NEWSLETTER_ITEM_TYPE,
        cacheScope: "account_private",
        ownerAccountId: address.accountId,
        sourceFingerprint: listId ?? fromAddress,
        status: "ready"
      }
    });
    const document = await tx.document.create({
      data: {
        contentObjectId: contentObject.id,
        ownerAccountId: address.accountId,
        contentType: "text/html",
        title: subject,
        articleHtml: content.html,
        text: contentText,
        contentHash: sha256(contentText),
        parserVersion: "newsletter-email-v1",
        metadataJson: JSON.stringify({
          fromName: message.fromName?.trim() || null,
          groupingReason: decision.reason,
          listId,
          receivedAt: message.receivedAt.toISOString(),
          webVersionUrl
        })
      }
    });
    await tx.documentChunk.createMany({
      data: chunkText(contentText).map((chunk, index) => ({
        documentId: document.id,
        chunkIndex: index,
        text: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
        contentHash: sha256(chunk),
        metadataJson: JSON.stringify({ source: "newsletter-email-v1" })
      }))
    });
    await tx.contentObject.update({
      where: { id: contentObject.id },
      data: { latestDocumentId: document.id }
    });
    const item = await tx.item.create({
      data: {
        libraryId: address.libraryId,
        sourceId: source.id,
        contentObjectId: contentObject.id,
        documentId: document.id,
        type: NEWSLETTER_ITEM_TYPE,
        title: subject,
        url: webVersionUrl,
        author: message.fromName?.trim() || fromAddress,
        publishedAt: message.receivedAt,
        status: "ready",
        savedToLibrary: false
      }
    });
    await tx.sourceEntry.create({
      data: {
        libraryId: address.libraryId,
        sourceId: source.id,
        itemId: item.id,
        entryKey,
        url: webVersionUrl,
        title: subject,
        author: message.fromName?.trim() || fromAddress,
        publishedAt: message.receivedAt
      }
    });
    const inbound = await tx.inboundEmail.create({
      data: {
        libraryId: address.libraryId,
        addressId: address.id,
        sourceId: source.id,
        itemId: item.id,
        providerMessageId: message.providerMessageId,
        messageId: normalizedMessageId,
        envelopeFrom: normalizeNewsletterEmailAddress(message.envelopeFrom),
        fromAddress,
        fromName: message.fromName?.trim() || null,
        listId,
        subject,
        status: "processed",
        spfVerdict: normalizedVerdict(message.spfVerdict),
        dkimVerdict: normalizedVerdict(message.dkimVerdict),
        dmarcVerdict: normalizedVerdict(message.dmarcVerdict),
        spamVerdict: normalizedVerdict(message.spamVerdict),
        virusVerdict: normalizedVerdict(message.virusVerdict),
        rawStorageKey: message.rawStorageKey,
        receivedAt: message.receivedAt,
        processedAt: now
      }
    });
    return { inbound, item, source };
  });

  return {
    action: "ingested",
    inboundEmailId: result.inbound.id,
    itemId: result.item.id,
    sourceId: result.source.id
  };
}
