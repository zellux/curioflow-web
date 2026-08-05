import { resolveMx } from "node:dns/promises";
import { GetBucketLocationCommand, S3Client } from "@aws-sdk/client-s3";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { getInfluxConfig, publishToInflux } from "@/server/monitoring";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";
import { getConfiguredTwitterBearerToken, testTwitterBearerToken } from "@/server/twitter-api";

export type ConnectionKey = "twitter" | "influx" | "newsletter";

export type ConnectionConfigRow = {
  configured: boolean;
  name: string;
  value: string;
};

export type ConnectionServiceSettings = {
  configured: boolean;
  description: string;
  enabled: boolean;
  key: ConnectionKey;
  rows: ConnectionConfigRow[];
  title: string;
};

export type ConnectionSettings = {
  influx: ConnectionServiceSettings;
  newsletter: ConnectionServiceSettings;
  twitter: ConnectionServiceSettings;
};

const NOT_SET = "not set";

function envValue(name: string, env: NodeJS.ProcessEnv) {
  return env[name]?.trim() ?? "";
}

function maskSecret(value: string) {
  if (!value) return NOT_SET;
  const raw = value.replace(/^Bearer\s+/i, "");
  if (raw.length <= 10) return "********";
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function displayValue(value: string, fallback = NOT_SET) {
  return value || fallback;
}

export function getConnectionSettings(env: NodeJS.ProcessEnv = process.env): ConnectionSettings {
  const twitterToken = envValue("TWITTER_BEARER_TOKEN", env) || envValue("CURIOFLOW_TWITTER_BEARER_TOKEN", env);
  const influxUrl = envValue("CURIOFLOW_INFLUXDB_URL", env);
  const influxIp = envValue("CURIOFLOW_INFLUXDB_IP", env) || envValue("CURIOFLOW_INFLUXDB_HOST", env);
  const influxUsername = envValue("CURIOFLOW_INFLUXDB_USERNAME", env);
  const influxPassword = envValue("CURIOFLOW_INFLUXDB_PASSWORD", env);
  const influxDatabase = envValue("CURIOFLOW_INFLUXDB_DATABASE", env) || "curioflow";
  const newsletter = newsletterInboundConfiguration(env);
  const influxConfigured = Boolean((influxUrl || influxIp) && influxUsername && influxPassword);

  return {
    twitter: {
      configured: Boolean(twitterToken),
      description: "Timeline import & tweet embeds",
      enabled: Boolean(twitterToken),
      key: "twitter",
      rows: [
        {
          configured: Boolean(twitterToken),
          name: twitterToken && envValue("CURIOFLOW_TWITTER_BEARER_TOKEN", env) ? "CURIOFLOW_TWITTER_BEARER_TOKEN" : "TWITTER_BEARER_TOKEN",
          value: maskSecret(twitterToken)
        }
      ],
      title: "Twitter API"
    },
    influx: {
      configured: influxConfigured,
      description: "Reading & sync monitoring",
      enabled: Boolean(influxUrl || influxIp || influxUsername || influxPassword),
      key: "influx",
      rows: [
        {
          configured: Boolean(influxUrl || influxIp),
          name: influxUrl ? "CURIOFLOW_INFLUXDB_URL" : "CURIOFLOW_INFLUXDB_IP",
          value: displayValue(influxUrl || influxIp)
        },
        {
          configured: Boolean(influxUsername),
          name: "CURIOFLOW_INFLUXDB_USERNAME",
          value: displayValue(influxUsername)
        },
        {
          configured: Boolean(influxPassword),
          name: "CURIOFLOW_INFLUXDB_PASSWORD",
          value: influxPassword ? "********" : NOT_SET
        },
        {
          configured: Boolean(influxDatabase),
          name: "CURIOFLOW_INFLUXDB_DATABASE",
          value: influxDatabase
        }
      ],
      title: "InfluxDB"
    },
    newsletter: {
      configured: newsletter.configured,
      description: "Inbound newsletter email",
      enabled: newsletter.requested,
      key: "newsletter",
      rows: [
        {
          configured: Boolean(newsletter.domain),
          name: "CURIOFLOW_NEWSLETTER_INBOUND_DOMAIN",
          value: displayValue(newsletter.domain ?? "")
        },
        {
          configured: Boolean(newsletter.bucket),
          name: "CURIOFLOW_NEWSLETTER_S3_BUCKET",
          value: displayValue(newsletter.bucket ?? "")
        },
        {
          configured: Boolean(newsletter.queueUrl),
          name: "CURIOFLOW_NEWSLETTER_SQS_URL",
          value: displayValue(newsletter.queueUrl ?? "")
        },
        {
          configured: Boolean(newsletter.region),
          name: "AWS_REGION",
          value: displayValue(newsletter.region ?? "")
        }
      ],
      title: "Newsletter email"
    }
  };
}

function normalizedBucketRegion(region: string | undefined) {
  if (!region) return "us-east-1";
  return region === "EU" ? "eu-west-1" : region;
}

async function testNewsletterConnection() {
  const configuration = newsletterInboundConfiguration();
  if (!configuration.enabled || !configuration.bucket || !configuration.domain || !configuration.queueUrl || !configuration.region) {
    return {
      ok: false,
      message: "Missing newsletter inbound domain, S3 bucket, SQS queue URL, or AWS region in .env."
    };
  }

  const s3 = new S3Client({ region: configuration.region });
  const sqs = new SQSClient({ region: configuration.region });
  const bucket = await s3.send(new GetBucketLocationCommand({ Bucket: configuration.bucket })).catch(() => null);
  if (!bucket) return { ok: false, message: "Curioflow cannot access the configured newsletter S3 bucket." };

  const queue = await sqs.send(new GetQueueAttributesCommand({
    AttributeNames: ["QueueArn", "ApproximateNumberOfMessages"],
    QueueUrl: configuration.queueUrl
  })).catch(() => null);
  if (!queue) return { ok: false, message: "Curioflow cannot access the configured newsletter SQS queue." };

  const mxRecords = await resolveMx(configuration.domain).catch(() => []);
  const bucketRegion = normalizedBucketRegion(bucket.LocationConstraint);
  if (bucketRegion !== configuration.region) {
    return { ok: false, message: `Newsletter S3 bucket is in ${bucketRegion}, but AWS_REGION is ${configuration.region}.` };
  }

  const expectedMx = `inbound-smtp.${configuration.region}.amazonaws.com`;
  if (!mxRecords.some((record) => record.exchange.toLowerCase().replace(/\.$/, "") === expectedMx)) {
    return { ok: false, message: `Newsletter MX record must point ${configuration.domain} to ${expectedMx}.` };
  }

  const pending = queue.Attributes?.ApproximateNumberOfMessages ?? "0";
  return {
    ok: true,
    message: `Newsletter email connected. S3 and SQS are reachable; ${pending} message${pending === "1" ? "" : "s"} waiting.`
  };
}

export async function testConnection(key: ConnectionKey) {
  if (key === "twitter") {
    const token = getConfiguredTwitterBearerToken();
    if (!token) {
      return {
        ok: false,
        message: "Missing TWITTER_BEARER_TOKEN in .env. Add it and restart Curioflow."
      };
    }

    await testTwitterBearerToken(token);
    return {
      ok: true,
      message: "Twitter API connected. Guest token endpoint responded."
    };
  }

  if (key === "newsletter") return testNewsletterConnection();

  const config = getInfluxConfig();
  if (!config) {
    return {
      ok: false,
      message: "Missing CURIOFLOW_INFLUXDB_URL/IP, username, or password in .env."
    };
  }

  await publishToInflux(config, [`curioflow_connection_test,service=curioflow value=1i ${Date.now()}`]);
  return {
    ok: true,
    message: `InfluxDB connected. Wrote a test point to ${config.database}.`
  };
}
