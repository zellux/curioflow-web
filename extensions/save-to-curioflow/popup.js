const $ = (id) => document.getElementById(id);
let tabId;
let server;
let action;
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("primary").onclick = () => action?.();
$("retry").onclick = () => save();

function render(result) {
  const saved = result.status === "saved";
  const setup = result.status === "setup";
  const auth = result.status === "auth";
  $("content").setAttribute("aria-busy", "false");
  $("symbol").className = `symbol ${saved ? "success" : ""}`;
  $("symbol").textContent = saved ? "✓" : setup ? "⌁" : "!";
  $("heading").textContent = saved ? "Saved to Curioflow" : setup ? "Connect to Curioflow" : auth ? "Sign in required" : "Could not save";
  $("message").textContent = result.message || (saved ? "Added to your library. Curioflow will extract the article in the background." : "Set your server address and grant access to start saving pages.");
  $("title").textContent = result.title || "";
  $("primary").hidden = !(saved || setup || auth);
  $("primary").textContent = saved ? "Open article ↗" : setup ? "Set server address" : "Sign in to Curioflow ↗";
  action = setup ? () => chrome.runtime.openOptionsPage() : () => chrome.tabs.create({ url: saved ? result.articleUrl : `${server}/login` });
  $("retry").hidden = saved || setup;
}

async function save() {
  $("primary").hidden = true;
  $("retry").hidden = true;
  $("title").textContent = "";
  $("heading").textContent = "Saving…";
  $("message").textContent = "Adding this page to your library.";
  $("symbol").textContent = "↑";
  $("symbol").className = "symbol loading";
  $("content").setAttribute("aria-busy", "true");
  try { render(await chrome.runtime.sendMessage({ type: "save", tabId })); }
  catch { render({ status: "error", message: "Could not reach the extension’s background worker. Close the popup and try again." }); }
}

async function initialize() {
  ({ server } = await chrome.storage.local.get("server"));
  if (!server) { render({ status: "setup" }); return; }
  $("server-label").textContent = server;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!Number.isInteger(tabId) || !/^https?:\/\//i.test(tab?.url || "")) {
    render({ status: "error", message: "Open an HTTP or HTTPS page, then click the extension icon again." });
    $("retry").hidden = true;
    return;
  }
  await save();
}
initialize().catch(() => render({ status: "error", message: "Could not load extension settings. Reopen the popup and try again." }));
