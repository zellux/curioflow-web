import assert from "node:assert/strict";
import test from "node:test";
import { isNewsletterSettingsHref, isSettingsOverlayHref, settingsOverlayHref } from "../app/settings-overlay-state.ts";

test("settings overlay uses a local URL state on the current page", () => {
  assert.equal(
    settingsOverlayHref("https://curioflow.test/item/article-1?q=llm#reader"),
    "/item/article-1?q=llm&settings=1#reader"
  );
});

test("settings overlay recognizes both local and canonical settings URLs", () => {
  assert.equal(isSettingsOverlayHref("/home?settings=1"), true);
  assert.equal(isSettingsOverlayHref("/home?settings=import"), true);
  assert.equal(isSettingsOverlayHref("/settings"), true);
  assert.equal(isSettingsOverlayHref("/home"), false);
});

test("newsletter settings opens from new and legacy links", () => {
  const href = settingsOverlayHref("/source/newsletter/example", "newsletter");
  assert.equal(href, "/source/newsletter/example?settings=newsletter");
  assert.equal(isNewsletterSettingsHref(href), true);
  assert.equal(isNewsletterSettingsHref("/settings?settingsTab=newsletter"), true);
  assert.equal(isNewsletterSettingsHref("/subscriptions?filter=newsletters&settings=import#import-newsletter"), true);
  assert.equal(isNewsletterSettingsHref("/subscriptions?filter=newsletters&settings=import"), false);
});
