import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from "@aws-sdk/client-sqs";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import PostalMime, { type Address } from "postal-mime";
import { ingestNewsletterMessage } from "@/server/ingest/newsletter";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";
import { parseSesNewsletterEvent } from "@/server/newsletter-ses-event";

function mailbox(address: Address | undefined) {
  if (!address) return null;
  if (Array.isArray(address.group)) return address.group[0] ?? null;
  return address;
}

function header(headers: Array<{ key: string; value: string }>, name: string) {
  return headers.find((candidate) => candidate.key.toLowerCase() === name.toLowerCase())?.value ?? null;
}

async function processMessage(
  message: Message,
  clients: { s3: S3Client; sqs: SQSClient },
  configuration: ReturnType<typeof newsletterInboundConfiguration>
) {
  if (!message.Body || !message.ReceiptHandle || !configuration.queueUrl || !configuration.bucket) {
    throw new Error("SQS newsletter message is missing its body, receipt handle, queue URL, or bucket");
  }
  const event = parseSesNewsletterEvent(message.Body);
  const object = await clients.s3.send(new GetObjectCommand({
    Bucket: event.bucket ?? configuration.bucket,
    Key: event.objectKey
  }));
  if (!object.Body) throw new Error(`Inbound newsletter object ${event.objectKey} has no body`);
  const raw = await object.Body.transformToByteArray();
  const parsed = await PostalMime.parse(raw);
  const from = mailbox(parsed.from);
  const listIdHeader = header(parsed.headers, "list-id") ?? event.listIdHeader;

  await ingestNewsletterMessage({
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
  });

  await clients.sqs.send(new DeleteMessageCommand({
    QueueUrl: configuration.queueUrl,
    ReceiptHandle: message.ReceiptHandle
  }));
}

let workerStarted = false;

export function ensureNewsletterInboundWorker() {
  const configuration = newsletterInboundConfiguration();
  if (workerStarted || !configuration.enabled || !configuration.queueUrl || !configuration.region) return;
  workerStarted = true;
  const clients = {
    s3: new S3Client({ region: configuration.region }),
    sqs: new SQSClient({ region: configuration.region })
  };

  const poll = async () => {
    try {
      const response = await clients.sqs.send(new ReceiveMessageCommand({
        QueueUrl: configuration.queueUrl!,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 120
      }));
      for (const message of response.Messages ?? []) {
        try {
          await processMessage(message, clients, configuration);
        } catch (error) {
          console.error("Curioflow newsletter ingestion failed", error);
        }
      }
    } catch (error) {
      console.error("Curioflow newsletter queue poll failed", error);
    } finally {
      const timer = setTimeout(poll, 1_000);
      timer.unref?.();
    }
  };

  void poll();
}
