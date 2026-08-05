export type NewsletterInboundEnvironment = Record<string, string | undefined>;

function configuredValue(environment: NewsletterInboundEnvironment, name: string) {
  return environment[name]?.trim() || null;
}

export function newsletterInboundConfiguration(environment: NewsletterInboundEnvironment = process.env) {
  const rawDomain = configuredValue(environment, "CURIOFLOW_NEWSLETTER_INBOUND_DOMAIN")?.toLowerCase() ?? null;
  const domain = rawDomain && /^[a-z0-9.-]+$/.test(rawDomain) ? rawDomain : null;
  const bucket = configuredValue(environment, "CURIOFLOW_NEWSLETTER_S3_BUCKET");
  const queueUrl = configuredValue(environment, "CURIOFLOW_NEWSLETTER_SQS_URL");
  const region = configuredValue(environment, "AWS_REGION");
  const requested = Boolean(rawDomain || bucket || queueUrl);

  return {
    bucket,
    configured: Boolean(domain && bucket && queueUrl && region),
    domain,
    enabled: Boolean(domain && bucket && queueUrl && region),
    queueUrl,
    region,
    requested
  };
}
