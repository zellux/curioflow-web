const TWITTER_GUEST_ACTIVATE_URL = "https://api.twitter.com/1.1/guest/activate.json";
const DEFAULT_TWITTER_BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

function withBearerPrefix(value: string) {
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

export function getConfiguredTwitterBearerToken(env: NodeJS.ProcessEnv = process.env) {
  const token = env.TWITTER_BEARER_TOKEN?.trim() || env.CURIOFLOW_TWITTER_BEARER_TOKEN?.trim();
  return token ? withBearerPrefix(token) : null;
}

export function getTwitterBearerToken(env: NodeJS.ProcessEnv = process.env) {
  return getConfiguredTwitterBearerToken(env) ?? DEFAULT_TWITTER_BEARER_TOKEN;
}

export async function testTwitterBearerToken(token: string) {
  const response = await fetch(TWITTER_GUEST_ACTIVATE_URL, {
    method: "POST",
    headers: {
      "authorization": withBearerPrefix(token),
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Twitter API returned HTTP ${response.status}`);
  }

  const data = await response.json().catch(() => null) as { guest_token?: unknown } | null;
  if (typeof data?.guest_token !== "string" || data.guest_token.length === 0) {
    throw new Error("Twitter API response did not include a guest token");
  }

  return data.guest_token;
}
