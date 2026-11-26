import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { completeTextWithLlm, llmReasoningTokenReserve } from "./llm.ts";

test("Meta sends authenticated chat completions with room for reasoning before visible text", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "https://api.meta.ai/v1/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-meta-key");
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "muse-spark-1.3-contributor");
    assert.ok(body.max_completion_tokens >= 4096 + 128);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.reasoning_effort, "minimal");
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.messages, [{ role: "user", content: "Test the connection." }]);
    return Response.json({ choices: [{ message: { content: " Curioflow LLM test OK " } }] });
  });

  assert.equal(await completeTextWithLlm({
    apiKey: "test-meta-key",
    baseUrl: "https://api.meta.ai/v1",
    model: "muse-spark-1.3-contributor",
    provider: "meta"
  }, [{ role: "user", content: "Test the connection." }], { maxTokens: 128, temperature: 0 }), "Curioflow LLM test OK");
});

test("existing OpenAI-compatible providers keep their requested completion parameters", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.max_tokens, 650);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.temperature, 0.2);
    return Response.json({ choices: [{ message: { content: "Summary" } }] });
  });

  assert.equal(await completeTextWithLlm({
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "example/model",
    provider: "openrouter"
  }, [{ role: "user", content: "Summarize" }], { maxTokens: 650 }), "Summary");
});

test("GPT-6 presets omit unsupported sampling and use completion tokens for reasoning plus text", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.temperature, undefined);
    assert.equal(body.reasoning_effort, "low");
    assert.ok(body.max_completion_tokens > 128);
    return Response.json({ choices: [{ message: { content: "Test OK" } }] });
  });
  for (const model of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]) {
    assert.equal(await completeTextWithLlm({
      apiKey: "test-key", baseUrl: "https://api.openai.com/v1", model, provider: "openai"
    }, [{ role: "user", content: "Test" }], { maxTokens: 128, temperature: 0 }), "Test OK");
  }
});

test("current Claude presets omit sampling and extract text after adaptive thinking blocks", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    assert.equal(new Headers(init.headers).get("x-api-key"), "test-key");
    const body = JSON.parse(String(init.body));
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.ok(body.max_tokens > 128);
    assert.equal(body.system, "Reply concisely.");
    assert.deepEqual(body.messages, [{ role: "user", content: "Test" }]);
    return Response.json({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Test OK" }] });
  });
  for (const model of ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
    assert.equal(await completeTextWithLlm({
      apiKey: "test-key", baseUrl: "https://api.anthropic.com/v1", model, provider: "anthropic"
    }, [{ role: "system", content: "Reply concisely." }, { role: "user", content: "Test" }], { maxTokens: 128, temperature: 0 }), "Test OK");
  }
});

test("current OpenRouter presets use its unified reasoning format with room for visible output", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.reasoning_effort, undefined);
    assert.ok(body.max_tokens > 650);
    return Response.json({ choices: [{ message: { content: "Summary" } }] });
  });
  for (const model of ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3", "z-ai/glm-5.3-flash", "xiaomi/mimo-v2.6-flash"]) {
    assert.equal(await completeTextWithLlm({
      apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1", model, provider: "openrouter"
    }, [{ role: "user", content: "Summarize" }], { maxTokens: 650 }), "Summary");
  }
});

test("empty OpenAI-compatible completions report why no visible text came back", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{ finish_reason: "length", message: { content: "" } }],
    usage: { completion_tokens: 4746, completion_tokens_details: { reasoning_tokens: 4746 } }
  }));

  await assert.rejects(completeTextWithLlm({
    apiKey: "test-meta-key",
    baseUrl: "https://api.meta.ai/v1",
    model: "muse-spark-1.3-contributor",
    provider: "meta"
  }, [{ role: "user", content: "Summarize" }], { maxTokens: 650 }), {
    message: "LLM response did not include text. (finish_reason: length; reasoning tokens: 4746 of 4746 completion tokens; the completion token limit was used up before any visible text)"
  });
});


test("translation callers reject provider-truncated output even when JSON is valid", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(globalThis, "fetch", async () => Response.json({
    stop_reason: "max_tokens", content: [{ type: "text", text: "[]" }],
    choices: [{ finish_reason: "length", message: { content: "[]" } }]
  }));
  for (const provider of ["openai", "anthropic"]) {
    await assert.rejects(completeTextWithLlm({
      apiKey: "test-key", baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1", model: "test", provider
    }, [{ role: "system", content: "Translate" }, { role: "user", content: "[]" }], { requireComplete: true }), /truncated/);
  }
});

test("reasoning none disables optional OpenRouter reasoning, keeps low for GLM 5.3, and falls back on 400", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if (body.model === "mandatory/model" && (body.reasoning as { enabled?: boolean } | undefined)?.enabled === false) {
      return Response.json({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }, { status: 400 });
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Translated" } }] });
  });

  for (const model of ["z-ai/glm-5.2", "z-ai/glm-4.7", "deepseek/deepseek-v4.1-flash", "xiaomi/mimo-v2.6-flash", "minimax/minimax-m3"]) {
    assert.equal(llmReasoningTokenReserve({ provider: "openrouter", model }, "none"), 0);
    assert.equal(await completeTextWithLlm({
      apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1", model, provider: "openrouter"
    }, [{ role: "user", content: "Translate" }], { maxTokens: 800, reasoning: "none" }), "Translated");
    const last = bodies.at(-1)!;
    assert.deepEqual(last.reasoning, { enabled: false });
    assert.equal(last.max_tokens, 800);
  }

  for (const model of ["z-ai/glm-5.3", "z-ai/glm-5.3-flash"]) {
    assert.equal(llmReasoningTokenReserve({ provider: "openrouter", model }, "none"), 4096);
    assert.equal(await completeTextWithLlm({
      apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1", model, provider: "openrouter"
    }, [{ role: "user", content: "Translate" }], { maxTokens: 800, reasoning: "none" }), "Translated");
    const last = bodies.at(-1)!;
    assert.deepEqual(last.reasoning, { effort: "low" });
    assert.equal(last.max_tokens, 800 + 4096);
  }

  assert.equal(await completeTextWithLlm({
    apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1", model: "mandatory/model", provider: "openrouter"
  }, [{ role: "user", content: "Translate" }], { maxTokens: 800, reasoning: "none" }), "Translated");
  const fallback = bodies.at(-1)!;
  assert.deepEqual(fallback.reasoning, { effort: "low" });
  assert.equal(fallback.max_tokens, 800 + 4096);
});

test("reasoning none uses model-safe settings across OpenAI, Anthropic, and Meta", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if (String(url).includes("anthropic")) {
      return Response.json({ content: [{ type: "text", text: "OK" }] });
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "OK" } }] });
  });

  assert.equal(llmReasoningTokenReserve({ provider: "openai", model: "gpt-6-luna" }, "none"), 0);
  assert.equal(llmReasoningTokenReserve({ provider: "openai", model: "gpt-6.1-sol" }, "none"), 4096);
  assert.equal(llmReasoningTokenReserve({ provider: "anthropic", model: "claude-sonnet-5-5" }, "none"), 0);
  assert.equal(llmReasoningTokenReserve({ provider: "meta", model: "muse-spark-1.3" }, "none"), 4096);

  await completeTextWithLlm({ apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna", provider: "openai" }, [{ role: "user", content: "T" }], { maxTokens: 500, reasoning: "none" });
  assert.equal(bodies.at(-1)!.reasoning_effort, "none");
  assert.equal(bodies.at(-1)!.max_completion_tokens, 500);

  await completeTextWithLlm({ apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol", provider: "openai" }, [{ role: "user", content: "T" }], { maxTokens: 500, reasoning: "none" });
  assert.equal(bodies.at(-1)!.reasoning_effort, "low");
  assert.equal(bodies.at(-1)!.max_completion_tokens, 500 + 4096);

  await completeTextWithLlm({ apiKey: "k", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", provider: "anthropic" }, [{ role: "user", content: "T" }], { maxTokens: 500, reasoning: "none" });
  assert.deepEqual(bodies.at(-1)!.thinking, { type: "between_tools" });
  assert.equal(bodies.at(-1)!.max_tokens, 500);

  await completeTextWithLlm({ apiKey: "k", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-5-5", provider: "anthropic" }, [{ role: "user", content: "T" }], { maxTokens: 500, reasoning: "none" });
  assert.deepEqual(bodies.at(-1)!.thinking, { type: "disabled" });
  assert.equal(bodies.at(-1)!.output_config, undefined);
  assert.equal(bodies.at(-1)!.max_tokens, 500);

  await completeTextWithLlm({ apiKey: "k", baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3", provider: "meta" }, [{ role: "user", content: "T" }], { maxTokens: 500, reasoning: "none" });
  assert.equal(bodies.at(-1)!.reasoning_effort, "minimal");
  assert.equal(bodies.at(-1)!.max_completion_tokens, 500 + 4096);
});
