import { getInfluxConfig, publishToInflux } from "@/server/monitoring";
import { getConfiguredTwitterBearerToken, testTwitterBearerToken } from "@/server/twitter-api";

export type ConnectionKey = "twitter" | "influx";

export type ConnectionConfigRow = {
  configured: boolean;
  name: string;
  value: string;
};

export type ConnectionServiceSettings = {
  configured: boolean;
  description: string;
  key: ConnectionKey;
  rows: ConnectionConfigRow[];
  title: string;
};

export type ConnectionSettings = {
  influx: ConnectionServiceSettings;
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
  const influxConfigured = Boolean((influxUrl || influxIp) && influxUsername && influxPassword);

  return {
    twitter: {
      configured: Boolean(twitterToken),
      description: "Timeline import & tweet embeds",
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
    }
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
