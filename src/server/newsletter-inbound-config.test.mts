import assert from "node:assert/strict";
import test from "node:test";
import { newsletterInboundConfiguration } from "./newsletter-inbound-config.ts";

test("newsletter inbound is optional when no settings are present", () => {
  assert.deepEqual(newsletterInboundConfiguration({}), {
    bucket: null,
    configured: false,
    domain: null,
    enabled: false,
    queueUrl: null,
    region: null,
    requested: false
  });
});

test("newsletter inbound requires the complete setting group", () => {
  const partial = newsletterInboundConfiguration({
    CURIOFLOW_NEWSLETTER_INBOUND_DOMAIN: "inbox.curioflow.net"
  });
  assert.equal(partial.requested, true);
  assert.equal(partial.enabled, false);

  const configured = newsletterInboundConfiguration({
    AWS_REGION: "us-west-2",
    CURIOFLOW_NEWSLETTER_INBOUND_DOMAIN: "Inbox.Curioflow.net",
    CURIOFLOW_NEWSLETTER_S3_BUCKET: "curioflow-newsletter-inbound",
    CURIOFLOW_NEWSLETTER_SQS_URL: "https://sqs.us-west-2.amazonaws.com/123/curioflow-newsletters-prod"
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.domain, "inbox.curioflow.net");
});
