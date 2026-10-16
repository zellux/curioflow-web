import assert from "node:assert/strict";
import test from "node:test";
import {
  contextWindowForOpenAiModel,
  contextWindowForMetaModel,
  contextWindowFromLmStudioResponse,
  contextWindowFromOllamaShowResponse,
  contextWindowFromOpenRouterResponse,
  fetchLlmContextWindow
} from "./llm-context-window.ts";

test("LM Studio uses the loaded context window instead of the theoretical maximum", () => {
  assert.equal(contextWindowFromLmStudioResponse({
    models: [{
      key: "qwen/qwen3-30b",
      loaded_instances: [{ config: { context_length: 8192 } }],
      max_context_length: 131072
    }]
  }, "qwen/qwen3-30b"), 8192);
});

test("Ollama reads the architecture-specific context length", () => {
  assert.equal(contextWindowFromOllamaShowResponse({
    model_info: {
      "gemma3.context_length": 131072,
      "gemma3.embedding_length": 2560
    }
  }, "gemma3"), 131072);
});

test("OpenRouter prefers the serving provider context window", () => {
  assert.equal(contextWindowFromOpenRouterResponse({
    data: [{
      id: "example/model",
      context_length: 131072,
      top_provider: { context_length: 65536 }
    }]
  }, "example/model"), 65536);
});

test("OpenAI context windows come from Curioflow's registry", () => {
  assert.equal(contextWindowForOpenAiModel("gpt-5.4-mini"), 400000);
  assert.equal(contextWindowForOpenAiModel("gpt-5.5"), 1050000);
  assert.equal(contextWindowForOpenAiModel("gpt-4.1-mini"), 1047576);
  assert.throws(() => contextWindowForOpenAiModel("future-model"), /Models API does not expose/);
});

test("Meta uses the documented context limits for Standard and Contributor models", async () => {
  for (const model of ["muse-spark-1.3", "muse-spark-1.3-contributor", "muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.1", "muse-wonder-1.0"]) {
    assert.equal(await fetchLlmContextWindow({
      apiKey: null,
      baseUrl: "https://api.meta.ai/v1",
      provider: "meta"
    }, model), 1048576);
  }
  assert.throws(() => contextWindowForMetaModel("meta/muse-spark-1.3-contributor"), /not in Curioflow's Meta model registry/);
  assert.throws(() => contextWindowForMetaModel("future-model"), /not in Curioflow's Meta model registry/);
});

test("local detection reads the configured LM Studio loaded instance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "http://127.0.0.1:1234/api/v1/models");
    return Response.json({
      models: [{
        key: "qwen/qwen3-30b",
        loaded_instances: [{ config: { context_length: 16384 } }],
        max_context_length: 131072
      }]
    });
  };
  try {
    assert.equal(await fetchLlmContextWindow({
      apiKey: null,
      baseUrl: "http://127.0.0.1:1234/v1",
      provider: "local"
    }, "qwen/qwen3-30b"), 16384);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
