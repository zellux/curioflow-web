import assert from "node:assert/strict";
import test from "node:test";
import { hasSecretEncryptionKey, isEncryptedSecret, openSecret, requireSecretEncryptionKeyForWrite, sealSecret, secretsMatch } from "./secrets.ts";

function withSecretKey<T>(value: string | undefined, callback: () => T) {
  const previous = process.env.CURIOFLOW_SECRET_KEY;
  if (value === undefined) {
    delete process.env.CURIOFLOW_SECRET_KEY;
  } else {
    process.env.CURIOFLOW_SECRET_KEY = value;
  }

  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.CURIOFLOW_SECRET_KEY;
    } else {
      process.env.CURIOFLOW_SECRET_KEY = previous;
    }
  }
}

test("plaintext secrets remain readable without an encryption key", () => {
  withSecretKey(undefined, () => {
    assert.equal(hasSecretEncryptionKey(), false);
    assert.equal(sealSecret("sk-test"), "sk-test");
    assert.equal(openSecret("sk-test"), "sk-test");
  });
});

test("secrets are encrypted and decrypted when a key is configured", () => {
  withSecretKey("test-secret-key", () => {
    const sealed = sealSecret("sk-test");

    assert.equal(hasSecretEncryptionKey(), true);
    assert.equal(isEncryptedSecret(sealed), true);
    assert.notEqual(sealed, "sk-test");
    assert.equal(openSecret(sealed), "sk-test");
  });
});

test("encrypted secrets require the same configured key", () => {
  const sealed = withSecretKey("test-secret-key", () => sealSecret("sk-test"));

  withSecretKey("different-secret-key", () => {
    assert.throws(() => openSecret(sealed));
  });
});

test("secret comparison decrypts encrypted values", () => {
  withSecretKey("test-secret-key", () => {
    assert.equal(secretsMatch(sealSecret("sk-test"), "sk-test"), true);
    assert.equal(secretsMatch(sealSecret("sk-test"), "sk-other"), false);
  });
});

test("production API key writes require an encryption key", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    withSecretKey(undefined, () => {
      assert.throws(() => requireSecretEncryptionKeyForWrite(), /CURIOFLOW_SECRET_KEY/);
    });
    withSecretKey("test-secret-key", () => {
      assert.doesNotThrow(() => requireSecretEncryptionKeyForWrite());
    });
  } finally {
    env.NODE_ENV = previousEnv;
  }
});
