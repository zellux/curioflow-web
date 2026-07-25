import { fetchJsonWithPolicy, llmAllowsPrivateNetwork, OutboundHttpError } from "./outbound-http.ts";

const CONTEXT_METADATA_TIMEOUT_MS = 15_000;
const MAX_CONTEXT_METADATA_BYTES = 2 * 1024 * 1024;

export type ContextWindowProbeSettings = {
  apiKey: string | null;
  baseUrl: string;
  provider: string;
};

type LmStudioModelsResponse = {
  models?: Array<{
    id?: unknown;
    key?: unknown;
    loaded_instances?: Array<{
      config?: {
        context_length?: unknown;
      };
    }>;
    max_context_length?: unknown;
  }>;
};

type OllamaRunningModelsResponse = {
  models?: Array<{
    context_length?: unknown;
    model?: unknown;
    name?: unknown;
  }>;
};

type OllamaShowResponse = {
  model_info?: Record<string, unknown>;
};

type OpenRouterModelsResponse = {
  data?: Array<{
    context_length?: unknown;
    id?: unknown;
    top_provider?: {
      context_length?: unknown;
    };
  }>;
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function modelMatches(candidate: unknown, requestedModel: string) {
  if (typeof candidate !== "string") return false;
  const withoutLatest = (value: string) => value.replace(/:latest$/, "");
  return candidate === requestedModel || withoutLatest(candidate) === withoutLatest(requestedModel);
}

function providerEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function localEndpoint(baseUrl: string, path: string) {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function requestOptions(
  allowPrivateNetwork: boolean,
  settings: ContextWindowProbeSettings,
  options: { body?: BodyInit; method?: string } = {}
) {
  return {
    allowPrivateNetwork,
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
    },
    includeResponseBodyInErrors: true,
    maxBytes: MAX_CONTEXT_METADATA_BYTES,
    timeoutMs: CONTEXT_METADATA_TIMEOUT_MS
  };
}

export function contextWindowFromLmStudioResponse(body: LmStudioModelsResponse, model: string) {
  const entry = body.models?.find((candidate) => modelMatches(candidate.key ?? candidate.id, model));
  if (!entry) throw new Error(`LM Studio did not return metadata for model "${model}".`);

  const loadedContextWindows = entry.loaded_instances
    ?.map((instance) => positiveInteger(instance.config?.context_length))
    .filter((value): value is number => value !== null) ?? [];
  if (loadedContextWindows.length > 0) return Math.min(...loadedContextWindows);

  const maximumContextWindow = positiveInteger(entry.max_context_length);
  if (maximumContextWindow) return maximumContextWindow;
  throw new Error(`LM Studio did not return a context window for model "${model}".`);
}

export function contextWindowFromOllamaShowResponse(body: OllamaShowResponse, model: string) {
  const contextWindows = Object.entries(body.model_info ?? {})
    .filter(([key]) => key.endsWith(".context_length"))
    .map(([, value]) => positiveInteger(value))
    .filter((value): value is number => value !== null);
  if (contextWindows.length === 0) {
    throw new Error(`Ollama did not return a context window for model "${model}".`);
  }
  return Math.max(...contextWindows);
}

export function contextWindowFromOpenRouterResponse(body: OpenRouterModelsResponse, model: string) {
  const entry = body.data?.find((candidate) => modelMatches(candidate.id, model));
  if (!entry) throw new Error(`OpenRouter did not return metadata for model "${model}".`);
  const contextWindow = positiveInteger(entry.top_provider?.context_length)
    ?? positiveInteger(entry.context_length);
  if (!contextWindow) throw new Error(`OpenRouter did not return a context window for model "${model}".`);
  return contextWindow;
}

export function contextWindowForOpenAiModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (/^gpt-5\.4-(mini|nano)(?:-|$)/.test(normalized)) return 400_000;
  if (/^gpt-5\.[456](?:-|$)/.test(normalized)) return 1_050_000;
  if (/^gpt-4\.1(?:-|$)/.test(normalized)) return 1_047_576;
  if (/^gpt-4o(?:-|$)/.test(normalized)) return 128_000;
  if (/^(o3|o4-mini)(?:-|$)/.test(normalized)) return 200_000;
  throw new Error(
    `OpenAI's Models API does not expose context-window size, and "${model}" is not in Curioflow's model registry.`
  );
}

async function fetchAnthropicContextWindow(settings: ContextWindowProbeSettings, model: string, allowPrivateNetwork: boolean) {
  const body = await fetchJsonWithPolicy<{ max_input_tokens?: unknown }>(
    providerEndpoint(settings.baseUrl, `/models/${encodeURIComponent(model)}`),
    {
      ...requestOptions(allowPrivateNetwork, settings),
      headers: {
        "anthropic-version": "2023-06-01",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {})
      }
    }
  );
  const contextWindow = positiveInteger(body.max_input_tokens);
  if (!contextWindow) throw new Error(`Anthropic did not return max_input_tokens for model "${model}".`);
  return contextWindow;
}

async function fetchOpenRouterContextWindow(settings: ContextWindowProbeSettings, model: string, allowPrivateNetwork: boolean) {
  const body = await fetchJsonWithPolicy<OpenRouterModelsResponse>(
    providerEndpoint(settings.baseUrl, "/models"),
    requestOptions(allowPrivateNetwork, settings)
  );
  return contextWindowFromOpenRouterResponse(body, model);
}

async function fetchOllamaContextWindow(settings: ContextWindowProbeSettings, model: string) {
  const running = await fetchJsonWithPolicy<OllamaRunningModelsResponse>(
    localEndpoint(settings.baseUrl, "/api/ps"),
    requestOptions(true, settings)
  );
  const loadedModel = running.models?.find((candidate) => (
    modelMatches(candidate.model, model) || modelMatches(candidate.name, model)
  ));
  const loadedContextWindow = positiveInteger(loadedModel?.context_length);
  if (loadedContextWindow) return loadedContextWindow;

  const details = await fetchJsonWithPolicy<OllamaShowResponse>(
    localEndpoint(settings.baseUrl, "/api/show"),
    requestOptions(true, settings, {
      body: JSON.stringify({ model, verbose: false }),
      method: "POST"
    })
  );
  return contextWindowFromOllamaShowResponse(details, model);
}

async function fetchLocalContextWindow(settings: ContextWindowProbeSettings, model: string) {
  try {
    const body = await fetchJsonWithPolicy<LmStudioModelsResponse>(
      localEndpoint(settings.baseUrl, "/api/v1/models"),
      requestOptions(true, settings)
    );
    return contextWindowFromLmStudioResponse(body, model);
  } catch (error) {
    if (!(error instanceof OutboundHttpError) || error.status !== 404) throw error;
  }

  return fetchOllamaContextWindow(settings, model);
}

export async function fetchLlmContextWindow(settings: ContextWindowProbeSettings, model: string) {
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new Error("Model ID is required to detect its context window.");

  if (settings.provider === "openai") return contextWindowForOpenAiModel(normalizedModel);
  if (settings.provider === "local") return fetchLocalContextWindow(settings, normalizedModel);

  const allowPrivateNetwork = await llmAllowsPrivateNetwork(settings.provider, settings.baseUrl);
  if (settings.provider === "anthropic") {
    return fetchAnthropicContextWindow(settings, normalizedModel, allowPrivateNetwork);
  }
  if (settings.provider === "openrouter") {
    return fetchOpenRouterContextWindow(settings, normalizedModel, allowPrivateNetwork);
  }
  throw new Error(`Context-window detection is not supported for provider "${settings.provider}".`);
}
