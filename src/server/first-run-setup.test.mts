import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("first-run setup creates the initial owner account once and closes immediately afterward", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curioflow-first-run-"));
  const environment = { ...process.env };
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env: process.env, stdio: "pipe" });

  const { prisma } = await import("./db.ts");
  const { createFirstRunOwnerAccount, isFirstRunSetupOpen } = await import("./first-run-setup.ts");
  const { authenticateUser, manualUrlSourceId } = await import("./auth.ts");

  try {
    assert.equal(await isFirstRunSetupOpen(), true);

    // Validation failures leave setup open.
    assert.deepEqual(
      await createFirstRunOwnerAccount({ username: "bad user", email: "owner@example.com", password: "strong-password" }),
      { ok: false, reason: "invalid-username" }
    );
    assert.deepEqual(
      await createFirstRunOwnerAccount({ username: "owner", email: "not-an-email", password: "strong-password" }),
      { ok: false, reason: "invalid-email" }
    );
    assert.deepEqual(
      await createFirstRunOwnerAccount({ username: "owner", email: "owner@example.com", password: "short" }),
      { ok: false, reason: "weak-password" }
    );
    assert.equal(await isFirstRunSetupOpen(), true);

    // A passwordless seeded placeholder does not lock out first-run owner creation.
    const seededAccount = await prisma.account.create({ data: { id: "account-local", name: "Local Reader" } });
    await prisma.user.create({
      data: { id: "user-local", accountId: seededAccount.id, displayName: "Local Reader", email: null, passwordHash: null }
    });
    assert.equal(await isFirstRunSetupOpen(), true);

    const created = await createFirstRunOwnerAccount({
      username: "owner",
      email: "Owner@Example.com",
      password: "strong-password"
    });
    assert.equal(created.ok, true);
    assert.equal(created.user.username, "owner");
    assert.equal(created.user.email, "owner@example.com");

    const library = await prisma.library.findFirstOrThrow({ where: { accountId: created.user.accountId } });
    const manualSource = await prisma.source.findUnique({ where: { id: manualUrlSourceId(library.id) } });
    assert.equal(manualSource?.type, "url");

    const authenticated = await authenticateUser("owner@example.com", "strong-password");
    assert.equal(authenticated?.id, created.user.id);

    // Once a passworded account exists, first-run setup is closed.
    assert.equal(await isFirstRunSetupOpen(), false);
    assert.deepEqual(
      await createFirstRunOwnerAccount({ username: "second", email: "second@example.com", password: "another-password" }),
      { ok: false, reason: "closed" }
    );
  } finally {
    await prisma.$disconnect();
    process.env = environment;
    rmSync(directory, { recursive: true, force: true });
  }
});
