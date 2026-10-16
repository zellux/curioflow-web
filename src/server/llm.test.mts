import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { completeTextWithLlm } from "./llm.ts";

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
