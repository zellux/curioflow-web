import { BACKGROUND_JOB_TYPES } from "@/server/background-job-state";
import { prisma } from "@/server/db";

const DEFAULT_MONITORING_INTERVAL_MS = 60_000;
const MIN_MONITORING_INTERVAL_MS = 10_000;
const DEFAULT_INFLUXDB_DATABASE = "curioflow";
const SERVICE_TAG = "curioflow";
const CRAWL_JOB_TYPES = new Set<string>([
  BACKGROUND_JOB_TYPES.FETCH_SOURCE,
  BACKGROUND_JOB_TYPES.INGEST_URL,
  BACKGROUND_JOB_TYPES.REFETCH_ARTICLE
]);

export type InfluxConfig = {
  database: string;
  intervalMs: number;
  password: string;
  url: URL;
  username: string;
};

type CountGroup = {
  _count: number;
};

type JobCountGroup = CountGroup & {
  status: string;
  type: string;
};

type ItemCountGroup = CountGroup & {
  status: string;
  type: string;
};

type SourceCountGroup = CountGroup & {
  status: string;
  type: string;
};

let schedulerStarted = false;
let publishing = false;
let lastPublishedAt: Date | null = null;

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function influxUrlFromEnv(env: NodeJS.ProcessEnv) {
  const explicitUrl = env.CURIOFLOW_INFLUXDB_URL?.trim();
  if (explicitUrl) return new URL(explicitUrl);

  const host = env.CURIOFLOW_INFLUXDB_IP?.trim() || env.CURIOFLOW_INFLUXDB_HOST?.trim();
  if (!host) return null;

  return new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
}

export function getInfluxConfig(env: NodeJS.ProcessEnv = process.env): InfluxConfig | null {
  const url = influxUrlFromEnv(env);
  const username = env.CURIOFLOW_INFLUXDB_USERNAME?.trim();
  const password = env.CURIOFLOW_INFLUXDB_PASSWORD?.trim();

  if (!url || !username || !password) return null;

  return {
    database: env.CURIOFLOW_INFLUXDB_DATABASE?.trim() || DEFAULT_INFLUXDB_DATABASE,
    intervalMs: Math.max(
      MIN_MONITORING_INTERVAL_MS,
      parsePositiveInt(env.CURIOFLOW_INFLUXDB_INTERVAL_MS, DEFAULT_MONITORING_INTERVAL_MS)
    ),
    password,
    url,
    username
  };
}

function escapeTag(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/=/g, "\\=").replace(/ /g, "\\ ");
}

function fieldValue(value: number | string | boolean) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }

  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? `${value}i` : String(value);
}

function lineProtocol(
  measurement: string,
  tags: Record<string, string | null | undefined>,
  fields: Record<string, number | string | boolean | null | undefined>,
  timestamp: Date
) {
  const tagText = Object.entries(tags)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${escapeTag(key)}=${escapeTag(value)}`)
    .join(",");
  const fieldText = Object.entries(fields)
    .map(([key, value]) => {
      if (value === null || value === undefined) return null;
      const serialized = fieldValue(value);
      return serialized ? `${escapeTag(key)}=${serialized}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join(",");

  if (!fieldText) return null;
  return `${escapeTag(measurement)}${tagText ? `,${tagText}` : ""} ${fieldText} ${timestamp.getTime()}`;
}

function appendGroupLines(
  lines: string[],
  measurement: string,
  groups: CountGroup[],
  tagKeys: string[],
  timestamp: Date
) {
  for (const group of groups) {
    const record = group as CountGroup & Record<string, unknown>;
    const tags = Object.fromEntries(
      tagKeys.map((key) => [key, typeof record[key] === "string" ? record[key] : undefined])
    );
    const line = lineProtocol(measurement, { service: SERVICE_TAG, ...tags }, { count: group._count }, timestamp);
    if (line) lines.push(line);
  }
}

async function collectOperationalMetrics(since: Date) {
  const now = new Date();
  const [
    userCount,
    accountCount,
    libraryCount,
    documentCount,
    annotationCount,
    itemGroups,
    sourceGroups,
    jobGroups,
    recentJobGroups
  ] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.library.count(),
    prisma.document.count(),
    prisma.annotation.count(),
    prisma.item.groupBy({
      by: ["type", "status"],
      _count: true
    }),
    prisma.source.groupBy({
      by: ["type", "status"],
      _count: true
    }),
    prisma.job.groupBy({
      by: ["type", "status"],
      _count: true
    }),
    prisma.job.groupBy({
      by: ["type", "status"],
      where: {
        OR: [
          { createdAt: { gte: since } },
          { startedAt: { gte: since } },
          { finishedAt: { gte: since } }
        ]
      },
      _count: true
    })
  ]);

  const lines: string[] = [];
  const crawlTotal = (jobGroups as JobCountGroup[])
    .filter((group) => CRAWL_JOB_TYPES.has(group.type))
    .reduce((sum, group) => sum + group._count, 0);
  const crawlRecent = (recentJobGroups as JobCountGroup[])
    .filter((group) => CRAWL_JOB_TYPES.has(group.type))
    .reduce((sum, group) => sum + group._count, 0);

  const overviewLine = lineProtocol(
    "curioflow_operational",
    { service: SERVICE_TAG },
    {
      accounts: accountCount,
      annotations: annotationCount,
      crawl_jobs_recent: crawlRecent,
      crawl_jobs_total: crawlTotal,
      documents: documentCount,
      libraries: libraryCount,
      users: userCount
    },
    now
  );
  if (overviewLine) lines.push(overviewLine);

  appendGroupLines(lines, "curioflow_items", itemGroups as ItemCountGroup[], ["type", "status"], now);
  appendGroupLines(lines, "curioflow_sources", sourceGroups as SourceCountGroup[], ["type", "status"], now);
  appendGroupLines(lines, "curioflow_jobs", jobGroups as JobCountGroup[], ["type", "status"], now);
  appendGroupLines(lines, "curioflow_jobs_recent", recentJobGroups as JobCountGroup[], ["type", "status"], now);

  return lines;
}

export async function publishToInflux(config: InfluxConfig, lines: string[]) {
  if (lines.length === 0) return;

  const writeUrl = new URL("/write", config.url);
  writeUrl.searchParams.set("db", config.database);
  writeUrl.searchParams.set("precision", "ms");

  const response = await fetch(writeUrl, {
    method: "POST",
    headers: {
      "authorization": `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      "content-type": "text/plain; charset=utf-8"
    },
    body: lines.join("\n")
  });

  if (!response.ok) {
    throw new Error(`InfluxDB metrics write failed with HTTP ${response.status}: ${await response.text()}`);
  }
}

export async function publishOperationalMetrics(config = getInfluxConfig()) {
  if (!config) return { enabled: false, lineCount: 0 };

  const since = lastPublishedAt ?? new Date(Date.now() - config.intervalMs);
  const lines = await collectOperationalMetrics(since);
  await publishToInflux(config, lines);
  lastPublishedAt = new Date();
  return { enabled: true, lineCount: lines.length };
}

export function ensureMonitoringScheduler() {
  const config = getInfluxConfig();
  if (!config || schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    if (publishing) return;
    publishing = true;
    void publishOperationalMetrics(config)
      .catch((error) => {
        console.error("Curioflow monitoring publish failed", error);
      })
      .finally(() => {
        publishing = false;
      });
  };

  tick();
  const interval = setInterval(tick, config.intervalMs);
  interval.unref?.();
}
