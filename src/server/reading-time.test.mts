import assert from "node:assert/strict";
import { test } from "node:test";
import { readingMinutes } from "./reading-time.ts";

test("reading time handles CJK, Latin, mixed text and missing content", () => {
  assert.equal(readingMinutes(null), null);
  assert.equal(readingMinutes("  "), null);
  assert.equal(readingMinutes("文章".repeat(401)), 3);
  assert.equal(readingMinutes("word ".repeat(480)), 2);
  assert.equal(readingMinutes("字".repeat(400) + " word".repeat(240)), 2);
});
