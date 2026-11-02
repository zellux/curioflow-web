import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("settings persist separate limits, preserve omitted mobile fields, reset on model change and drive runtime budgets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-context-settings-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });
  const { prisma } = await import("./db.ts");
  const { saveLlmSettingsForAccount, getLlmSettingsForAccount, getLlmRuntimeSettingsForAccount, getAskLlmRuntimeSettingsForAccount } = await import("./settings.ts");
  try {
    const account = await prisma.account.create({ data: { name: "Context settings test" } });
    const input = { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna", askModel: "gpt-6.1-sol" };
    await saveLlmSettingsForAccount(account.id, { ...input, contextWindowLimit: "32768", askContextWindowLimit: 65536 });
    assert.equal((await getLlmRuntimeSettingsForAccount(account.id)).modelContextWindow, 32768);
    assert.equal((await getAskLlmRuntimeSettingsForAccount(account.id)).modelContextWindow, 65536);
    await saveLlmSettingsForAccount(account.id, { provider: input.provider, baseUrl: input.baseUrl, model: input.model });
    let saved = await getLlmSettingsForAccount(account.id);
    assert.equal(saved.contextWindowLimit, 32768);
    assert.equal(saved.askContextWindowLimit, 65536);
    assert.equal(saved.modelContextWindow, 1050000);
    for (const contextWindowLimit of [2047, "invalid", 1050001]) {
      await assert.rejects(saveLlmSettingsForAccount(account.id, { ...input, contextWindowLimit }));
    }
    assert.equal((await getLlmSettingsForAccount(account.id)).contextWindowLimit, 32768);
    await saveLlmSettingsForAccount(account.id, { ...input, contextWindowLimit: "", askContextWindowLimit: null });
    assert.equal((await getLlmRuntimeSettingsForAccount(account.id)).modelContextWindow, 1050000);
    await saveLlmSettingsForAccount(account.id, { ...input, contextWindowLimit: 32768, askContextWindowLimit: 65536 });
    await saveLlmSettingsForAccount(account.id, { ...input, model: "gpt-4o" });
    saved = await getLlmSettingsForAccount(account.id);
    assert.equal(saved.contextWindowLimit, null);
    assert.equal(saved.askContextWindowLimit, 65536);
    assert.equal((await getLlmRuntimeSettingsForAccount(account.id)).modelContextWindow, 128000);
  } finally {
    await prisma.$disconnect();
    process.env = environment;
    rmSync(directory, { recursive: true, force: true });
  }
});
