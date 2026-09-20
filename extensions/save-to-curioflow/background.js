import { hostPermission, pageAddress, savePage, serverAddress } from "./shared.js";

// Keep the request independent of the popup, and coalesce repeated clicks.
const pending = new Map();
async function save(tabId) {
  const { server: configured } = await chrome.storage.local.get("server");
  if (!configured) return { status: "setup" };
  const server = serverAddress(configured);
  if (!await chrome.permissions.contains({ origins: [hostPermission(server)] })) return { status: "setup" };
  const tab = await chrome.tabs.get(tabId);
  const url = pageAddress(tab.url || "");
  const key = JSON.stringify([server, url]);
  if (pending.has(key)) return pending.get(key);
  const request = savePage(server, url);
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || message?.type !== "save" || !Number.isInteger(message.tabId)) return;
  save(message.tabId).then(respond, (error) => respond({ status: "error", message: error.message || "保存失败，请重试。" }));
  return true;
});
