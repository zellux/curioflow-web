import assert from "node:assert/strict";
import test from "node:test";
import { READ_STATUS } from "./item-state.ts";
import {
  MAX_MOBILE_MUTATIONS_PER_REQUEST,
  mobileMutationBatchValidationError,
  mobileUpdateBaseUpdatedAt,
  mobileUpdateClientMutationId,
  mobileUpdateItemId,
  mobileUpdateProgressMode,
  normalizeMobileItemUpdate
} from "./mobile-sync-state.ts";

test("mobile sync rejects oversized mutation batches instead of truncating", () => {
  assert.equal(
    mobileMutationBatchValidationError(Array.from({ length: MAX_MOBILE_MUTATIONS_PER_REQUEST + 1 }, () => ({}))),
    "itemUpdates must contain at most 100 entries"
  );
  assert.equal(
    mobileMutationBatchValidationError(Array.from({ length: MAX_MOBILE_MUTATIONS_PER_REQUEST }, () => ({}))),
    null
  );
});

test("mobile sync trims item ids", () => {
  assert.equal(mobileUpdateItemId({ itemId: " item-1 " }), "item-1");
  assert.equal(mobileUpdateItemId({ itemId: 42 }), "");
});

test("mobile sync parses mutation metadata", () => {
  assert.equal(mobileUpdateClientMutationId({ clientMutationId: " mutation-1 " }), "mutation-1");
  assert.equal(mobileUpdateClientMutationId({ clientMutationId: 42 }), null);
  assert.deepEqual(
    mobileUpdateBaseUpdatedAt({ baseUpdatedAt: "2026-07-02T12:00:00.000Z" }),
    new Date("2026-07-02T12:00:00.000Z")
  );
  assert.equal(mobileUpdateBaseUpdatedAt({ baseUpdatedAt: "later" }), null);
  assert.equal(mobileUpdateProgressMode({ progressMode: "advance" }), "advance");
  assert.equal(mobileUpdateProgressMode({ progressMode: "reset" }), "set");
});

test("mobile sync clamps finite reading progress", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");
  assert.deepEqual(normalizeMobileItemUpdate({ readingProgress: 1.4 }, now), {
    ok: true,
    data: {
      lastReadAt: now,
      readingProgress: 1
    }
  });
});

test("mobile sync rejects invalid reading progress", () => {
  const result = normalizeMobileItemUpdate({ readingProgress: Number.NaN });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /readingProgress/);
});

test("mobile sync serializes object reading positions only", () => {
  assert.deepEqual(normalizeMobileItemUpdate({ readingPosition: { block: "intro", offset: 12 } }), {
    ok: true,
    data: {
      readingPositionJson: JSON.stringify({ block: "intro", offset: 12 })
    }
  });

  const result = normalizeMobileItemUpdate({ readingPosition: ["intro"] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /readingPosition/);
});

test("mobile sync normalizes read status and validates booleans", () => {
  assert.deepEqual(normalizeMobileItemUpdate({ archived: true, readStatus: "read", savedToLibrary: false }, new Date("2026-07-02T12:00:00.000Z")), {
    ok: true,
    data: {
      archivedAt: new Date("2026-07-02T12:00:00.000Z"),
      readStatus: READ_STATUS.DONE,
      savedToLibrary: false
    }
  });

  const readStatus = normalizeMobileItemUpdate({ readStatus: "finished" });
  assert.equal(readStatus.ok, false);

  const savedToLibrary = normalizeMobileItemUpdate({ savedToLibrary: "false" });
  assert.equal(savedToLibrary.ok, false);
});
