import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsOverlayHref, settingsOverlayHref } from "../app/settings-overlay-state.ts";

test("settings overlay uses a local URL state on the current page", () => {
  assert.equal(
    settingsOverlayHref("https://curioflow.test/item/article-1?q=llm#reader"),
    "/item/article-1?q=llm&settings=1#reader"
  );
});

test("settings overlay recognizes both local and canonical settings URLs", () => {
  assert.equal(isSettingsOverlayHref("/home?settings=1"), true);
  assert.equal(isSettingsOverlayHref("/settings"), true);
  assert.equal(isSettingsOverlayHref("/home"), false);
});
