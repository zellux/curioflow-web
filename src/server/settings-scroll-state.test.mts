import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSettingsScrollSnapshot,
  restoredSettingsScrollTop
} from "../app/settings-scroll-state.ts";

test("settings scroll restoration offsets content inserted above the viewport", () => {
  assert.equal(restoredSettingsScrollTop(
    { contentHeight: 1000, contentTop: 400 },
    { clientHeight: 500, scrollHeight: 1080 }
  ), 480);
});

test("settings scroll restoration remains within the new scroll range", () => {
  assert.equal(restoredSettingsScrollTop(
    { contentHeight: 1000, contentTop: 900 },
    { clientHeight: 500, scrollHeight: 1080 }
  ), 580);
  assert.equal(restoredSettingsScrollTop(
    { contentHeight: 1000, contentTop: 20 },
    { clientHeight: 500, scrollHeight: 800 }
  ), 0);
});

test("settings scroll snapshots are parsed defensively", () => {
  assert.deepEqual(parseSettingsScrollSnapshot(JSON.stringify({
    contentHeight: 1000,
    contentTop: 400,
    pathname: "/home",
    windowTop: 120
  })), {
    contentHeight: 1000,
    contentTop: 400,
    pathname: "/home",
    windowTop: 120
  });
  assert.equal(parseSettingsScrollSnapshot("{broken"), null);
  assert.equal(parseSettingsScrollSnapshot(JSON.stringify({ contentTop: "400" })), null);
});
