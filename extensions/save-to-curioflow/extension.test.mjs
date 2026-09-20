import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { hostPermission, pageAddress, savePage, serverAddress } from "./shared.js";

test("server and page addresses preserve ports and paths but reject unsafe input", () => {
  assert.equal(serverAddress(" http://192.168.3.30:3000/ "), "http://192.168.3.30:3000");
  assert.equal(serverAddress("https://example.com/reader/"), "https://example.com/reader");
  assert.equal(hostPermission("http://localhost:3000"), "http://localhost/*");
  for (const url of ["example.com", "file:///tmp", "https://user:pass@example.com", "https://example.com?token=abc", "https://example.com/#foo"]) assert.throws(() => serverAddress(url));
  for (const url of ["chrome://extensions", "file:///tmp/x", "javascript:alert(1)", "https://user:pass@example.com"]) assert.throws(() => pageAddress(url));
  assert.equal(pageAddress("https://example.com/story?a=1#part"), "https://example.com/story?a=1#part");
});

test("save uses session credentials and returns an encoded reader route", async () => {
  const result = await savePage("https://reader.test/base", "https://example.com/story", async (url, init) => {
    assert.equal(url, "https://reader.test/base/api/urls");
    assert.equal(init.credentials, "include");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { url: "https://example.com/story" });
    return Response.json({ item: { id: "a/b", title: "An article" } }, { status: 201 });
  });
  assert.equal(result.articleUrl, "https://reader.test/base/item/a%2Fb");
  assert.equal(result.status, "saved");
});

test("authentication, HTTP, malformed responses and network failures never report success", async () => {
  for (const status of [401, 403]) {
    assert.equal((await savePage("https://reader.test", "https://example.com", async () => new Response("", { status }))).status, "auth");
  }
  for (const response of [new Response("<html>Login</html>"), Response.json({ item: {} }), Response.json({ error: "Unavailable" }, { status: 503 })]) {
    await assert.rejects(savePage("https://reader.test", "https://example.com", async () => response));
  }
  await assert.rejects(savePage("https://reader.test", "https://example.com", async () => { throw new TypeError("fetch failed"); }), /未能确认/);
});

test("worker merges in-flight saves and rejects messages from other pages", async () => {
  let listener;
  let finish;
  let calls = 0;
  const chrome = {
    storage: { local: { get: async () => ({ server: "https://reader.test" }) } },
    permissions: { contains: async () => true },
    tabs: { get: async () => ({ url: "https://example.com/article" }) },
    runtime: { id: "extension", getURL: (p) => `chrome-extension://extension/${p}`, onMessage: { addListener: (fn) => { listener = fn; } } }
  };
  const source = await readFile(new URL("background.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import .*;\n/, ""), {
    chrome, hostPermission, pageAddress, serverAddress,
    savePage: () => { calls++; return new Promise((resolve) => { finish = resolve; }); }
  });
  const sender = { id: "extension", url: chrome.runtime.getURL("popup.html") };
  const send = () => new Promise((resolve) => assert.equal(listener({ type: "save", tabId: 1 }, sender, resolve), true));
  const a = send(); const b = send();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish({ status: "saved" });
  assert.deepEqual(await a, await b);
  assert.equal(listener({ type: "save", tabId: 1 }, { ...sender, url: "https://evil.test" }, () => assert.fail()), undefined);
});

test("popup automatically saves, renders safe text and opens the returned article", async () => {
  const dom = new JSDOM(await readFile(new URL("popup.html", import.meta.url), "utf8"));
  const opened = [];
  const requests = [];
  const chrome = {
    storage: { local: { get: async () => ({ server: "https://reader.test" }) } },
    tabs: { query: async () => [{ id: 7, url: "https://example.com/story" }], create: (args) => opened.push(args) },
    runtime: { sendMessage: async (message) => { requests.push(message); return { status: "saved", title: "<img src=x onerror=alert(1)>", articleUrl: "https://reader.test/item/123" }; } }
  };
  vm.runInNewContext(await readFile(new URL("popup.js", import.meta.url), "utf8"), { document: dom.window.document, chrome });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tabId, 7);
  const document = dom.window.document;
  assert.equal(document.getElementById("heading").textContent, "已保存到 Curioflow");
  assert.equal(document.getElementById("title").children.length, 0);
  document.getElementById("primary").click();
  assert.equal(opened[0].url, "https://reader.test/item/123");
  dom.window.close();
});

test("popup authentication recovery opens the configured server login", async () => {
  const dom = new JSDOM(await readFile(new URL("popup.html", import.meta.url), "utf8"));
  let opened;
  const chrome = {
    storage: { local: { get: async () => ({ server: "http://localhost:3000" }) } },
    tabs: { query: async () => [{ id: 1, url: "https://example.com" }], create: ({ url }) => { opened = url; } },
    runtime: { sendMessage: async () => ({ status: "auth", message: "请登录" }) }
  };
  vm.runInNewContext(await readFile(new URL("popup.js", import.meta.url), "utf8"), { document: dom.window.document, chrome });
  await new Promise((resolve) => setImmediate(resolve));
  dom.window.document.getElementById("primary").click();
  assert.equal(opened, "http://localhost:3000/login");
  assert.equal(dom.window.document.getElementById("retry").hidden, false);
  dom.window.close();
});
