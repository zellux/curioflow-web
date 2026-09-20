import { hostPermission, serverAddress } from "./shared.js";
const input = document.getElementById("server");
const status = document.getElementById("status");
const login = document.getElementById("login");
let savedServer;
login.onclick = () => chrome.tabs.create({ url: `${savedServer}/login` });
chrome.storage.local.get("server").then(({ server }) => {
  input.value = server || "";
  savedServer = server;
  login.hidden = !server;
}).catch(() => { status.textContent = "无法读取设置，请重新打开此页。"; });
document.getElementById("settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const submit = document.getElementById("submit");
  submit.disabled = true;
  try {
    const server = serverAddress(input.value);
    // Request permission directly within this user gesture.
    const granted = await chrome.permissions.request({ origins: [hostPermission(server)] });
    if (!granted) throw new Error("需要允许访问这台服务器才能保存文章，请再次保存设置并允许访问。");
    await chrome.storage.local.set({ server });
    savedServer = server;
    input.value = server;
    login.hidden = false;
    status.textContent = "设置已保存。请确认已登录，然后回到文章页面点击扩展图标。";
  } catch (error) { status.textContent = error.message || "设置保存失败，请重试。"; }
  finally { submit.disabled = false; }
};
