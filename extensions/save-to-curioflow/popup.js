import { serverAddress } from "./shared.js";

const $ = (id) => document.getElementById(id);
const states = {
  loading: { heading: "Saving…", message: "Adding this page to your library." },
  saved: { heading: "Saved to Curioflow", message: "Added to your library.", symbol: "✓", primary: "Open article ↗" },
  "already-saved": { heading: "Already saved", message: "This article is already in your library.", symbol: "↺", primary: "Open article ↗" },
  setup: { heading: "Connect to Curioflow", message: "Set your HTTPS server address to start saving pages.", symbol: "↗", primary: "Set server address" },
  auth: { heading: "Sign in required", symbol: "!", primary: "Sign in to Curioflow ↗", retry: true },
  error: { heading: "Could not save", symbol: "!", retry: true }
};

let tabId;
let server;
let action;
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("primary").onclick = () => action?.();
$("retry").onclick = () => save();

function render(result) {
  const state = states[result.status];
  const loading = result.status === "loading";
  const articleUrl = result.articleUrl;
  $("content").dataset.state = result.status;
  $("heading").textContent = state.heading;
  $("message").textContent = result.message || state.message || "";
  $("symbol").textContent = state.symbol || "";
  $("title").textContent = result.title || "";
  $("article").hidden = !result.title;
  $("article").title = result.title || "";
  $("primary").textContent = state.primary || "";
  $("primary").hidden = !state.primary;
  $("retry").hidden = !state.retry || !Number.isInteger(tabId);
  $("feedback").setAttribute("aria-busy", String(loading));

  if (result.status === "setup") {
    action = () => chrome.runtime.openOptionsPage();
  } else if (result.status === "auth") {
    action = () => chrome.tabs.create({ url: `${server}/login` });
  } else {
    action = articleUrl ? () => chrome.tabs.create({ url: articleUrl }) : undefined;
  }
}

async function save() {
  render({ status: "loading" });
  try {
    render(await chrome.runtime.sendMessage({ type: "save", tabId }));
  } catch {
    render({ status: "error", message: "Could not reach the extension’s background worker. Close the popup and try again." });
  }
}

async function initialize() {
  const { server: configured } = await chrome.storage.local.get("server");
  if (!configured) {
    render({ status: "setup" });
    return;
  }
  try {
    server = serverAddress(configured);
  } catch (error) {
    render({ status: "setup", message: error.message });
    return;
  }
  const serverLabel = $("server-label");
  serverLabel.textContent = server;
  serverLabel.title = server;
  serverLabel.hidden = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !/^https?:\/\//i.test(tab?.url || "")) {
    render({ status: "error", message: "Open an HTTP or HTTPS page, then click the extension icon again." });
    return;
  }
  tabId = tab.id;
  await save();
}

initialize().catch(() => render({ status: "error", message: "Could not load extension settings. Reopen the popup and try again." }));
