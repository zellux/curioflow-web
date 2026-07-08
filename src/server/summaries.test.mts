import assert from "node:assert/strict";
import test from "node:test";
import { parseSummaryResponse } from "./summary-response.ts";

test("summary parser repairs invalid math backslash escapes", () => {
  const summary = parseSummaryResponse(String.raw`{
    "overview": "这篇文章讨论 \log x 与 \exp x 的函数关系。",
    "points": ["保留 \alpha 这样的数学符号。", "解释函数迭代。", "连接形式幂级数。"]
  }`);

  assert.equal(summary.overview, String.raw`这篇文章讨论 \log x 与 \exp x 的函数关系。`);
  assert.deepEqual(summary.points, [
    String.raw`保留 \alpha 这样的数学符号。`,
    "解释函数迭代。",
    "连接形式幂级数。"
  ]);
});

test("summary parser keeps valid JSON escapes intact", () => {
  const summary = parseSummaryResponse(String.raw`{"overview":"Line one\nLine two","points":["quoted \"term\"","slash \/ ok","unicode \u4e2d"]}`);

  assert.equal(summary.overview, "Line one\nLine two");
  assert.deepEqual(summary.points, ["quoted \"term\"", "slash / ok", "unicode 中"]);
});
