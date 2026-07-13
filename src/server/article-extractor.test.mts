import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  articleFetchHeadersForUrl,
  extractTwitterSyndicationArticle,
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

test("Twitter extractor expands an article attached through a quoted post", async () => {
  const originalFetch = globalThis.fetch;
  const quotingPostId = "2076481232117067894";
  const quotedPostId = "2076323181154230284";

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/1.1/guest/activate.json") {
      return Response.json({ guest_token: "test-guest-token" });
    }

    if (url.hostname === "api.twitter.com" && url.pathname.includes("TweetResultByRestId")) {
      const variables = JSON.parse(url.searchParams.get("variables") ?? "{}") as { tweetId?: string };
      if (variables.tweetId === quotingPostId) {
        return Response.json({ data: { tweetResult: { result: { rest_id: quotingPostId } } } });
      }

      return Response.json({
        data: {
          tweetResult: {
            result: {
              rest_id: quotedPostId,
              article: {
                article_results: {
                  result: {
                    rest_id: "2076319195718090753",
                    title: "The Reverse Information Paradox",
                    preview_text: "Article preview",
                    plain_text: "Full quoted article paragraph one.\n\nFull quoted article paragraph two."
                  }
                }
              },
              core: {
                user_results: {
                  result: { core: { name: "Satya Nadella", screen_name: "satyanadella" } }
                }
              },
              legacy: { created_at: "2026-07-12T15:09:57.000Z", lang: "en" }
            }
          }
        }
      });
    }

    if (url.hostname === "cdn.syndication.twimg.com") {
      return Response.json({
        __typename: "Tweet",
        id_str: quotingPostId,
        text: "Commentary on the quoted article.",
        user: { name: "Yu Su", screen_name: "ysu_nlp" },
        quoted_tweet: {
          id_str: quotedPostId,
          article: {
            rest_id: "2076319195718090753",
            title: "The Reverse Information Paradox",
            preview_text: "Article preview"
          }
        }
      });
    }

    throw new Error(`Unexpected test request: ${url}`);
  };

  try {
    const result = await extractTwitterSyndicationArticle(`https://x.com/ysu_nlp/status/${quotingPostId}`);

    assert.equal(result?.parserVersion, "twitter-quoted-article-graphql-v1");
    assert.equal(result?.title, "The Reverse Information Paradox");
    assert.match(result?.text ?? "", /Commentary by Yu Su \(@ysu_nlp\)/);
    assert.match(result?.text ?? "", /Full quoted article paragraph two/);
    assert.equal(result?.metadata.extractionScope, "quoted_tweet_article_full_text");
    assert.equal(result?.metadata.quotedPostId, quotedPostId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
