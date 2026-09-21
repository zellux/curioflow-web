import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { enqueueNewsletterEvent } from "@/server/newsletter-jobs";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";
import { recordWorkerHeartbeat } from "@/server/worker-heartbeat";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";

let workerStarted = false;

export function ensureNewsletterInboundWorker() {
  const configuration = newsletterInboundConfiguration();
  if (!backgroundWorkRunsHere() || workerStarted || !configuration.enabled || !configuration.queueUrl || !configuration.region) return;
  workerStarted = true;
  const sqs = new SQSClient({ region: configuration.region });
  let failures = 0;
  const poll = async () => {
    try {
      await recordWorkerHeartbeat("newsletter");
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: configuration.queueUrl!, MaxNumberOfMessages: 5,
        WaitTimeSeconds: 20, VisibilityTimeout: 120
      }), { abortSignal: AbortSignal.timeout(30_000) });
      let delivered = true;
      for (const message of response.Messages ?? []) {
        try {
          if (!message.Body || !message.ReceiptHandle) throw new Error("Incomplete newsletter notification");
          // ACK only after the database owns retries; expensive parsing happens separately.
          await enqueueNewsletterEvent(message.Body);
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: configuration.queueUrl!, ReceiptHandle: message.ReceiptHandle
          }), { abortSignal: AbortSignal.timeout(10_000) });
        } catch (error) {
          delivered = false;
          console.error("Curioflow newsletter enqueue failed", error);
        }
      }
      failures = delivered ? 0 : failures + 1;
      await recordWorkerHeartbeat("newsletter", delivered);
    } catch (error) {
      failures += 1;
      console.error("Curioflow newsletter queue poll failed", error);
    } finally {
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
      const timer = setTimeout(poll, delay);
      timer.unref?.();
    }
  };
  void poll();
}
