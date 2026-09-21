import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import PostalMime, { type Address } from "postal-mime";
import { prisma } from "@/server/db";
import { ingestNewsletterMessage } from "@/server/ingest/newsletter";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";
import { parseSesNewsletterEvent } from "@/server/newsletter-ses-event";
import { claimQueuedJob, fencedJobWhere, type JobLease } from "@/server/job-claim";
import { recordBackgroundJobFailure } from "@/server/job-retry";
import { serializeJobProgress } from "@/server/job-progress";

export async function enqueueNewsletterEvent(body: string) {
  const event = parseSesNewsletterEvent(body);
  const configuration = newsletterInboundConfiguration();
  if (event.bucket && event.bucket !== configuration.bucket) throw new Error("Unexpected newsletter storage bucket");
  const address = await prisma.newsletterAddress.findFirst({
    where: { address: event.address, status: "active" }, select: { id: true, libraryId: true }
  });
  if (!address) return; // Unknown/disabled recipients are terminal, not retryable.
  const dedupeKey = `newsletter:${createHash("sha256").update(`${address.id}:${event.providerMessageId}`).digest("hex")}`;
  return prisma.job.upsert({
    where: { dedupeKey }, update: {},
    create: {
      dedupeKey, libraryId: address.libraryId, type: "ingest_newsletter", status: "queued",
      payloadJson: JSON.stringify({ body }),
      progressJson: serializeJobProgress({ stage: "queued" })
    }
  });
}

export async function processNewsletterJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "ingest_newsletter") return;
  const lease = await claimQueuedJob(job);
  if (!lease) return;
  try {
    const payload = JSON.parse(job.payloadJson) as { body: string };
    const result = await ingestEvent(payload.body, lease);
    await prisma.job.updateMany({
      where: fencedJobWhere(lease),
      data: {
        status: "succeeded", sourceId: result.sourceId,
        finishedAt: new Date(), lockedUntil: null, leaseOwner: null, nextRunAt: null,
        progressJson: serializeJobProgress({ stage: "succeeded", outcome: result.action })
      }
    });
  } catch (error) {
    await recordBackgroundJobFailure(job.id, error, lease);
  }
}

function mailbox(address: Address | undefined) {
  if (!address) return null;
  if (Array.isArray(address.group)) return address.group[0] ?? null;
  return address;
}

function header(headers: Array<{ key: string; value: string }>, name: string) {
  return headers.find((candidate) => candidate.key.toLowerCase() === name.toLowerCase())?.value ?? null;
}

async function ingestEvent(body: string, lease: JobLease) {
  const configuration = newsletterInboundConfiguration();
  if (!configuration.bucket || !configuration.region) throw new Error("Newsletter connection is not configured");
  const event = parseSesNewsletterEvent(body);
  if (event.bucket && event.bucket !== configuration.bucket) throw new Error("Unexpected newsletter storage bucket");
  const clients = { s3: new S3Client({ region: configuration.region }) };
  const object = await clients.s3.send(new GetObjectCommand({
    Bucket: event.bucket ?? configuration.bucket,
    Key: event.objectKey
  }), { abortSignal: AbortSignal.timeout(60_000) });
  if (object.ContentLength && object.ContentLength > 25 * 1024 * 1024) throw new Error("Newsletter exceeds 25 MB");
  if (!object.Body) throw new Error(`Inbound newsletter object ${event.objectKey} has no body`);
  const raw = await object.Body.transformToByteArray();
  if (raw.length > 25 * 1024 * 1024) throw new Error("Newsletter exceeds 25 MB");
  const parsed = await PostalMime.parse(raw);
  const from = mailbox(parsed.from);
  const listIdHeader = header(parsed.headers, "list-id") ?? event.listIdHeader;

  return ingestNewsletterMessage({
    address: event.address,
    authenticatedDomain: event.authenticatedDomain,
    authenticatedFrom: event.authenticatedFrom,
    dkimVerdict: event.dkimVerdict,
    dmarcVerdict: event.dmarcVerdict,
    envelopeFrom: event.envelopeFrom ?? parsed.returnPath,
    fromAddress: from?.address ?? null,
    fromName: from?.name ?? null,
    html: parsed.html,
    listIdHeader,
    messageId: parsed.messageId,
    providerMessageId: event.providerMessageId,
    rawStorageKey: `${event.bucket ?? configuration.bucket}/${event.objectKey}`,
    receivedAt: event.receivedAt,
    spamVerdict: event.spamVerdict,
    spfVerdict: event.spfVerdict,
    subject: parsed.subject ?? event.subject,
    text: parsed.text,
    virusVerdict: event.virusVerdict
  }, lease);

}
