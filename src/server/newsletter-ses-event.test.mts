import assert from "node:assert/strict";
import test from "node:test";
import { parseSesNewsletterEvent } from "./newsletter-ses-event.ts";

function notification(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    Type: "Notification",
    Message: JSON.stringify({
      Records: [{
        eventSource: "aws:ses",
        ses: {
          mail: {
            commonHeaders: { from: ["Lenny <hello@newsletter.example>"], subject: "Weekly issue" },
            destination: ["reader.abc@inbox.curioflow.net"],
            headers: [
              { name: "List-ID", value: "Lenny's Newsletter <lenny.newsletter.example>" },
              { name: "DKIM-Signature", value: "v=1; d=newsletter.example; s=mail" }
            ],
            messageId: "ses-message-1",
            source: "bounce@newsletter.example",
            timestamp: "2026-08-01T12:00:00.000Z"
          },
          receipt: {
            action: { bucketName: "curioflow-inbound", objectKey: "emails/ses-message-1" },
            dkimVerdict: { status: "PASS" },
            dmarcVerdict: { status: "PASS" },
            spamVerdict: { status: "PASS" },
            spfVerdict: { status: "PASS" },
            virusVerdict: { status: "PASS" }
          },
          ...overrides
        }
      }]
    })
  });
}

function receivedNotification() {
  return JSON.stringify({
    Type: "Notification",
    Message: JSON.stringify({
      notificationType: "Received",
      mail: {
        commonHeaders: { from: ["TLDR <dan@tldrnewsletter.com>"], subject: "Confirm your subscription to TLDR" },
        destination: ["reader.abc@inbox.curioflow.net"],
        headers: [{ name: "DKIM-Signature", value: "v=1; d=tldrnewsletter.com; s=mail" }],
        messageId: "ses-confirmation-1",
        source: "bounce@tldrnewsletter.com",
        timestamp: "2026-08-02T20:00:00.000Z"
      },
      receipt: {
        action: { type: "S3", bucketName: "curioflow-newsletter-inbound", objectKey: "raw/ses-confirmation-1" },
        dkimVerdict: { status: "PASS" },
        spamVerdict: { status: "PASS" },
        spfVerdict: { status: "PASS" },
        virusVerdict: { status: "PASS" }
      }
    })
  });
}

test("parses an SNS-wrapped SES receipt and authentication evidence", () => {
  const event = parseSesNewsletterEvent(notification());
  assert.equal(event.address, "reader.abc@inbox.curioflow.net");
  assert.equal(event.objectKey, "emails/ses-message-1");
  assert.equal(event.listIdHeader, "Lenny's Newsletter <lenny.newsletter.example>");
  assert.equal(event.authenticatedFrom, true);
  assert.equal(event.authenticatedDomain, "newsletter.example");
});

test("does not authenticate an unaligned DKIM signature", () => {
  const body = notification({
    mail: {
      commonHeaders: { from: ["Attacker <hello@attacker.example>"] },
      destination: ["reader.abc@inbox.curioflow.net"],
      headers: [{ name: "DKIM-Signature", value: "v=1; d=unrelated.example; s=mail" }],
      messageId: "ses-message-2"
    },
    receipt: {
      action: { objectKey: "emails/ses-message-2" },
      dkimVerdict: { status: "PASS" },
      dmarcVerdict: { status: "FAIL" }
    }
  });
  assert.equal(parseSesNewsletterEvent(body).authenticatedFrom, false);
});

test("parses a confirmation-email SES notification", () => {
  const event = parseSesNewsletterEvent(receivedNotification());
  assert.equal(event.address, "reader.abc@inbox.curioflow.net");
  assert.equal(event.objectKey, "raw/ses-confirmation-1");
  assert.equal(event.bucket, "curioflow-newsletter-inbound");
  assert.equal(event.subject, "Confirm your subscription to TLDR");
  assert.equal(event.authenticatedFrom, true);
  assert.equal(event.authenticatedDomain, "tldrnewsletter.com");
});
