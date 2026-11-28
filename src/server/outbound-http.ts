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
  readonly status?: number;

  constructor(message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "OutboundHttpError";
    this.status = options.status;
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
  acceptedBodyPrefixes?: Array<{ prefix: string; maxBytes: number }>;
  acceptedContentTypes?: string[];
  acceptedStatuses?: number[];
  allowPrivateNetwork?: boolean;
  body?: BodyInit;
  headers?: HeadersInit;
  includeResponseBodyInErrors?: boolean;
  maxBytes: number;
  method?: string;
  redirectLimit?: number;
  requiredBodyPrefix?: string;
  timeoutMs: number;
};

export type BoundedHttpResponse = {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
  headers: Headers;
  status: number;
};

type ReadBoundedBodyOptions = {
  acceptedBodyPrefixes?: Array<{ prefix: string; maxBytes: number }>;
  contentTypeMatches: boolean;
  declaredLength: number;
  maxBytes: number;
  requiredBodyPrefix?: string;
};

async function readBoundedBody(response: Response, options: ReadBoundedBodyOptions) {
  if (!response.body) {
    if (options.requiredBodyPrefix) {
      throw new OutboundHttpError("Outbound response did not match the expected file signature");
    }
    if (!options.contentTypeMatches) {
      throw new OutboundHttpError("Outbound response used an unsupported content type");
    }
    return { bytes: new Uint8Array(), truncated: false };
  }

  const encoder = new TextEncoder();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const prefix = options.requiredBodyPrefix ? encoder.encode(options.requiredBodyPrefix) : null;
  let prefixCandidates = options.acceptedBodyPrefixes?.map((entry) => ({
    bytes: encoder.encode(entry.prefix),
    maxBytes: entry.maxBytes
  })) ?? null;
  let matchedPrefixMaxBytes: number | null = null;
  let effectiveMaxBytes = prefixCandidates
    ? Math.max(options.contentTypeMatches ? options.maxBytes : 0, ...prefixCandidates.map((entry) => entry.maxBytes))
    : options.maxBytes;
  let totalBytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (prefix && totalBytes < prefix.length) {
      const start = value.subarray(0, prefix.length - totalBytes);
      if (start.some((byte, index) => byte !== prefix[totalBytes + index])) {
        await reader.cancel();
        throw new OutboundHttpError("Outbound response did not match the expected file signature");
      }
    }
    if (prefixCandidates && matchedPrefixMaxBytes === null && prefixCandidates.length > 0) {
      const remainingCandidates: typeof prefixCandidates = [];
      for (const candidate of prefixCandidates) {
        const compareCount = Math.min(value.byteLength, Math.max(0, candidate.bytes.length - totalBytes));
        let matches = true;
        for (let index = 0; index < compareCount; index += 1) {
          if (value[index] !== candidate.bytes[totalBytes + index]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        if (totalBytes + value.byteLength >= candidate.bytes.length) {
          matchedPrefixMaxBytes = candidate.maxBytes;
          break;
        }
        remainingCandidates.push(candidate);
      }
      if (matchedPrefixMaxBytes !== null) {
        effectiveMaxBytes = matchedPrefixMaxBytes;
        prefixCandidates = [];
        if (Number.isFinite(options.declaredLength) && options.declaredLength > effectiveMaxBytes) {
          await reader.cancel();
          throw new OutboundHttpError("Outbound response exceeded its size limit");
        }
      } else {
        prefixCandidates = remainingCandidates;
        if (prefixCandidates.length === 0) {
          if (!options.contentTypeMatches) {
            await reader.cancel();
            throw new OutboundHttpError("Outbound response used an unsupported content type");
          }
          effectiveMaxBytes = options.maxBytes;
          if (Number.isFinite(options.declaredLength) && options.declaredLength > effectiveMaxBytes) {
            await reader.cancel();
            throw new OutboundHttpError("Outbound response exceeded its size limit");
          }
        }
      }
    }
    if (totalBytes + value.byteLength > effectiveMaxBytes) {
      const remainingBytes = Math.max(0, effectiveMaxBytes - totalBytes);
      if (remainingBytes > 0) chunks.push(value.slice(0, remainingBytes));
      totalBytes = effectiveMaxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    totalBytes += value.byteLength;
    chunks.push(value);
  }
  if (prefix && totalBytes < prefix.length && !truncated) {
    throw new OutboundHttpError("Outbound response did not match the expected file signature");
  }
  if (options.acceptedBodyPrefixes && matchedPrefixMaxBytes === null && !options.contentTypeMatches) {
    throw new OutboundHttpError("Outbound response used an unsupported content type");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function responseErrorDetail(text: string) {
  const compactText = text.replace(/\s+/g, " ").trim();
  if (!compactText) return null;

  try {
    const body = JSON.parse(compactText) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const nestedError = typeof body.error === "object" && body.error
      ? (body.error as { message?: unknown }).message
      : body.error;
    const detail = [nestedError, body.message, body.detail].find((value) => typeof value === "string" && value.trim());
    if (typeof detail === "string") return detail.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    // Non-JSON provider errors are still useful when they are short and bounded.
  }

  return compactText.slice(0, 500);
}

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
    let response: Response | undefined;
    try {
      response = await fetch(safeUrl, {
      redirect: "manual",
      method: options.method,
      body: options.body,
      headers: options.headers,
      signal: AbortSignal.timeout(remainingMs)
    });
    if (response.status >= 300 && response.status < 400) {
      if (options.acceptedStatuses?.includes(response.status)) {
        return {
          bytes: new Uint8Array(),
          contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
          finalUrl: response.url || safeUrl.toString(),
          headers: response.headers,
          status: response.status
        };
      }
      const location = response.headers.get("location");
      if (!location) throw new OutboundHttpError("Outbound redirect did not include a location");
      if (redirectCount >= redirectLimit) throw new OutboundHttpError("Outbound request exceeded its redirect limit");
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    const acceptedStatus = options.acceptedStatuses?.includes(response.status) ?? false;
    if (!response.ok && !acceptedStatus) {
      const errorBody = options.includeResponseBodyInErrors
        ? await readBoundedBody(response, {
            contentTypeMatches: true,
            declaredLength: 0,
            maxBytes: Math.min(options.maxBytes, 16 * 1024)
          })
        : null;
      const detail = errorBody
        ? responseErrorDetail(new TextDecoder().decode(errorBody.bytes))
        : null;
      throw new OutboundHttpError(
        `Outbound request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const contentTypeMatches = !options.acceptedContentTypes
      || options.acceptedContentTypes.some((accepted) => contentType.includes(accepted));
    if (!contentTypeMatches && (!options.acceptedBodyPrefixes || options.acceptedBodyPrefixes.length === 0)) {
      throw new OutboundHttpError("Outbound response used an unsupported content type");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    const maxAllowedBytes = options.acceptedBodyPrefixes?.length
      ? Math.max(contentTypeMatches ? options.maxBytes : 0, ...options.acceptedBodyPrefixes.map((entry) => entry.maxBytes))
      : options.maxBytes;
    if (Number.isFinite(declaredLength) && declaredLength > maxAllowedBytes) {
      throw new OutboundHttpError("Outbound response exceeded its size limit");
    }
    if (!response.body) throw new OutboundHttpError("Outbound response did not include a body");
    const body = await readBoundedBody(response, {
      acceptedBodyPrefixes: options.acceptedBodyPrefixes,
      contentTypeMatches,
      declaredLength,
      maxBytes: options.maxBytes,
      requiredBodyPrefix: options.requiredBodyPrefix
    });
    if (body.truncated) {
      throw new OutboundHttpError("Outbound response exceeded its size limit");
    }
    const bytes = body.bytes;
    return { bytes, contentType, finalUrl: response.url || safeUrl.toString(), headers: response.headers, status: response.status };
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
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
  meta: "api.meta.ai",
  openai: "api.openai.com",
  openrouter: "openrouter.ai"
};

export async function llmAllowsPrivateNetwork(
  provider: string,
  baseUrl: string,
  production = process.env.NODE_ENV === "production"
) {
  const url = parseHttpUrl(baseUrl);
  if (provider === "local") return true;

  if (production) {
    const expectedHost = CLOUD_LLM_HOSTS[provider];
    if (!expectedHost || url.protocol !== "https:" || url.hostname !== expectedHost) {
      throw new OutboundHttpError("The configured LLM origin is not allowed in production");
    }
    await assertPublicHttpUrl(url.toString());
    return false;
  }

  await assertPublicHttpUrl(url.toString());
  return false;
}
