import { lookup } from "node:dns/promises";
import net from "node:net";

const DEFAULT_REDIRECT_LIMIT = 5;
const DEFAULT_PER_HOST_CONCURRENCY = 4;

type HostConcurrencyState = {
  active: number;
  waiters: Array<() => void>;
};

const hostConcurrency = new Map<string, HostConcurrencyState>();

function perHostConcurrencyLimit() {
  const configured = Number(process.env.CURIOFLOW_OUTBOUND_PER_HOST_CONCURRENCY);
  return Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : DEFAULT_PER_HOST_CONCURRENCY;
}

async function acquireHostSlot(hostname: string) {
  const state = hostConcurrency.get(hostname) ?? { active: 0, waiters: [] };
  hostConcurrency.set(hostname, state);
  if (state.active >= perHostConcurrencyLimit()) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else {
    state.active += 1;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = state.waiters.shift();
    if (next) {
      next();
      return;
    }
    state.active -= 1;
    if (state.active === 0) hostConcurrency.delete(hostname);
  };
}

export async function withOutboundHostSlot<T>(hostname: string, operation: () => Promise<T>) {
  const release = await acquireHostSlot(hostname.toLowerCase());
  try {
    return await operation();
  } finally {
    release();
  }
}

export class OutboundHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHttpError";
  }
}

export function isBlockedNetworkAddress(address: string) {
  if (net.isIPv4(address)) {
    const [first, second] = address.split(".").map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || first >= 224;
  }
  if (!net.isIPv6(address)) return true;

  const normalized = address.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:169.254.")
    || normalized.startsWith("::ffff:192.168.");
}

function parseHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundHttpError("Outbound URL is invalid");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new OutboundHttpError("Only HTTP and HTTPS outbound URLs are allowed");
  }
  if (url.username || url.password) {
    throw new OutboundHttpError("Outbound URLs cannot contain credentials");
  }
  return url;
}

export async function assertPublicHttpUrl(rawUrl: string) {
  const url = parseHttpUrl(rawUrl);
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new OutboundHttpError("Outbound URL targets a blocked network address");
  }

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
    throw new OutboundHttpError("Outbound URL targets a blocked network address");
  }
  return url;
}

type OutboundFetchOptions = {
  acceptedContentTypes: string[];
  allowPrivateNetwork?: boolean;
  body?: BodyInit;
  headers?: HeadersInit;
  maxBytes: number;
  method?: string;
  redirectLimit?: number;
  timeoutMs: number;
};

export type BoundedHttpResponse = {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
  headers: Headers;
};

export async function fetchBytesWithPolicy(rawUrl: string, options: OutboundFetchOptions): Promise<BoundedHttpResponse> {
  const deadline = Date.now() + options.timeoutMs;
  const redirectLimit = options.redirectLimit ?? DEFAULT_REDIRECT_LIMIT;
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= redirectLimit; redirectCount += 1) {
    const safeUrl = options.allowPrivateNetwork
      ? parseHttpUrl(currentUrl)
      : await assertPublicHttpUrl(currentUrl);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new OutboundHttpError("Outbound request timed out");

    const releaseHostSlot = await acquireHostSlot(safeUrl.hostname.toLowerCase());
    try {
      const response = await fetch(safeUrl, {
      redirect: "manual",
      method: options.method,
      body: options.body,
      headers: options.headers,
      signal: AbortSignal.timeout(remainingMs)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new OutboundHttpError("Outbound redirect did not include a location");
      if (redirectCount >= redirectLimit) throw new OutboundHttpError("Outbound request exceeded its redirect limit");
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) throw new OutboundHttpError(`Outbound request failed with HTTP ${response.status}`);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!options.acceptedContentTypes.some((accepted) => contentType.includes(accepted))) {
      throw new OutboundHttpError("Outbound response used an unsupported content type");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      throw new OutboundHttpError("Outbound response exceeded its size limit");
    }
    if (!response.body) throw new OutboundHttpError("Outbound response did not include a body");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel();
        throw new OutboundHttpError("Outbound response exceeded its size limit");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
      return { bytes, contentType, finalUrl: response.url || safeUrl.toString(), headers: response.headers };
    } finally {
      releaseHostSlot();
    }
  }

  throw new OutboundHttpError("Outbound request exceeded its redirect limit");
}

export async function fetchTextWithPolicy(rawUrl: string, options: OutboundFetchOptions) {
  const response = await fetchBytesWithPolicy(rawUrl, options);
  return { ...response, text: new TextDecoder().decode(response.bytes) };
}

export async function fetchJsonWithPolicy<T>(rawUrl: string, options: Omit<OutboundFetchOptions, "acceptedContentTypes">) {
  const response = await fetchTextWithPolicy(rawUrl, {
    ...options,
    acceptedContentTypes: ["application/json"]
  });
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new OutboundHttpError("Outbound response did not contain valid JSON");
  }
}

const CLOUD_LLM_HOSTS: Record<string, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  openrouter: "openrouter.ai"
};

export async function llmAllowsPrivateNetwork(
  provider: string,
  baseUrl: string,
  production = process.env.NODE_ENV === "production"
) {
  const url = parseHttpUrl(baseUrl);
  if (production) {
    const expectedHost = CLOUD_LLM_HOSTS[provider];
    if (!expectedHost || url.protocol !== "https:" || url.hostname !== expectedHost) {
      throw new OutboundHttpError("The configured LLM origin is not allowed in Cloud mode");
    }
    await assertPublicHttpUrl(url.toString());
    return false;
  }

  if (provider === "local") return true;
  await assertPublicHttpUrl(url.toString());
  return false;
}
