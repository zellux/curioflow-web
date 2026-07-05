import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  articleFetchHeadersForUrl,
  extractWeChatArticleFromDocument,
  maxHtmlBytesForUrl,
  type HtmlFetchResult
} from "./ingest/extractors/article.ts";

const WECHAT_URL = "https://mp.weixin.qq.com/s/RRHg9UCCInSc_zEcIgjNBQ";

test("article fetches use browser navigation headers for WeChat", () => {
  const headers = articleFetchHeadersForUrl(WECHAT_URL);

  assert.match(headers["user-agent"], /Mozilla\/5\.0/);
  assert.equal(headers["sec-fetch-mode"], "navigate");
  assert.equal(headers["sec-fetch-dest"], "document");
  assert.equal(headers["upgrade-insecure-requests"], "1");
  assert.match(headers["accept-language"], /zh-CN/);
  assert.ok(maxHtmlBytesForUrl(WECHAT_URL) > 12_382_978);
});

test("WeChat extractor reads the real article container", () => {
  const body = `${"This paragraph stands in for long WeChat article text. ".repeat(8)}`;
  const html = `
    <html lang="zh-CN">
      <body>
        <h1 id="activity-name">详细谈谈DSpark投机解码的原理</h1>
        <a id="js_name">zartbot</a>
        <div id="js_content">
          <p>渣b又一夜返贫, 回到没卡没token的状态。</p>
          <h2>TL;DR</h2>
          <p>DSpark 是 DeepSeek 刚开源的一个投机解码框架。${body}</p>
          <p><img data-src="https://mmbiz.qpic.cn/demo.png" /></p>
        </div>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: WECHAT_URL, contentType: "text/html" });
  const fetched: HtmlFetchResult = {
    html,
    finalUrl: WECHAT_URL,
    contentType: "text/html; charset=UTF-8",
    fetchProfile: "browser-navigation-wechat"
  };

  const result = extractWeChatArticleFromDocument(dom.window.document, fetched);

  assert.equal(result?.parserVersion, "wechat-js-content-v1");
  assert.equal(result?.title, "详细谈谈DSpark投机解码的原理");
  assert.equal(result?.author, "zartbot");
  assert.match(result?.text ?? "", /TL;DR\n\nDSpark/);
  assert.match(result?.contentHtml ?? "", /src="https:\/\/mmbiz\.qpic\.cn\/demo\.png"/);
});
