import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { normalizeArticleMath } from "./ingest/extractors/article.ts";
import { sanitizeArticleHtml } from "./reader/rendering.ts";

test("reader renders inline and display TeX without executing source scripts", () => {
  const html = sanitizeArticleHtml(`
    <p>Predict <span>\\(Y\\)</span> from features.</p>
    <p><span>\\[ \\hat{Y} = f(X) \\]</span></p>
    <script>alert("unsafe")</script>
  `);

  assert.match(html ?? "", /class="readerMath"/);
  assert.match(html ?? "", /class="readerMath readerMath--display"/);
  assert.match(html ?? "", /class="katex"/);
  assert.doesNotMatch(html ?? "", /<script|alert\(/);
});

test("reader leaves TeX in code samples untouched", () => {
  const html = sanitizeArticleHtml("<p>Formula: \\(x^2\\)</p><pre><code>\\(not rendered\\)</code></pre>");

  assert.match(html ?? "", /data-tex="x\^2"/);
  assert.match(html ?? "", /<code>\\\(not rendered\\\)<\/code>/);
});

test("article extraction normalizes MathJax and KaTeX sources to portable TeX", () => {
  const dom = new JSDOM(`
    <body>
      <p>Inline <script type="math/tex">x^2</script></p>
      <div class="katex-display"><span class="katex"><math display="block"><semantics>
        <annotation encoding="application/x-tex">\\frac{a}{b}</annotation>
      </semantics></math></span></div>
    </body>
  `);

  const math = normalizeArticleMath(dom.window.document);
  const text = dom.window.document.body.textContent ?? "";

  assert.equal(math.hasMath, true);
  assert.deepEqual(math.sources, ["katex", "mathjax-tex-script", "mathml"]);
  assert.match(text, /\\\(x\^2\\\)/);
  assert.match(text, /\\\[\\frac\{a\}\{b\}\\\]/);
});
