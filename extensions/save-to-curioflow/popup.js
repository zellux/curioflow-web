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
  $("heading").textContent = saved ? "已保存到 Curioflow" : setup ? "连接你的 Curioflow" : auth ? "需要登录" : "暂时未能保存";
  $("message").textContent = result.message || (saved ? "已加入 Library，正文将在后台解析。" : "首次使用，请设置你的服务器地址。");
  $("title").textContent = result.title || "";
  $("primary").hidden = !(saved || setup || auth);
  $("primary").textContent = saved ? "打开文章 ↗" : setup ? "设置服务器地址" : "打开 Curioflow 登录 ↗";
  action = setup ? () => chrome.runtime.openOptionsPage() : () => chrome.tabs.create({ url: saved ? result.articleUrl : `${server}/login` });
  $("retry").hidden = saved || setup;
}

async function save() {
  $("primary").hidden = true;
  $("retry").hidden = true;
  $("title").textContent = "";
  $("heading").textContent = "正在保存…";
  $("message").textContent = "正在将当前网页添加到你的 Library。";
  $("symbol").textContent = "↑";
  $("symbol").className = "symbol loading";
  $("content").setAttribute("aria-busy", "true");
  try { render(await chrome.runtime.sendMessage({ type: "save", tabId })); }
  catch { render({ status: "error", message: "无法连接扩展后台，请关闭弹窗后重试。" }); }
}

async function initialize() {
  ({ server } = await chrome.storage.local.get("server"));
  if (!server) { render({ status: "setup" }); return; }
  $("server-label").textContent = server;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!Number.isInteger(tabId) || !/^https?:\/\//i.test(tab?.url || "")) {
    render({ status: "error", message: "请打开一篇 HTTP / HTTPS 网页后，再点击扩展图标。" });
    $("retry").hidden = true;
    return;
  }
  await save();
}
initialize().catch(() => render({ status: "error", message: "无法读取扩展设置，请重新打开弹窗。" }));
