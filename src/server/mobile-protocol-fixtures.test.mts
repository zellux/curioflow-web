import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mobileProtocolMetadata } from "./mobile-protocol.ts";

async function fixture(name: string) {
  const path = new URL(`../../test/fixtures/mobile-v1/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

test("mobile v1 session fixture carries self-hosted compatibility metadata", async () => {
  const payload = await fixture("session");
  const protocol = payload.protocol as Record<string, unknown>;
  assert.equal(protocol.version, 1);
  assert.equal(protocol.minimumClientVersion, "1.0.0");
  assert.deepEqual(protocol.capabilities, ["ios_access", "revision_sync", "annotation_mutations"]);
  assert.equal(protocol.plan, "self_hosted");
  const advertised = mobileProtocolMetadata();
  for (const capability of protocol.capabilities as string[]) {
    assert.equal((advertised.capabilities as readonly string[]).includes(capability), true);
  }
});

test("mobile v1 sync fixture covers paging, content, annotations, and tombstones", async () => {
  const payload = await fixture("sync");
  assert.equal(payload.syncMode, "delta");
  assert.equal(payload.watermark, "42");
  assert.equal(payload.hasMore, false);
  const items = payload.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0].readStatus, "future_status");
  assert.equal((items[0].annotations as unknown[]).length, 1);
  assert.equal((payload.tombstones as unknown[]).length, 1);
});
