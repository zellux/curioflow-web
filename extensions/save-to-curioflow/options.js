import { hostPermission, serverAddress } from "./shared.js";
const input = document.getElementById("server");
const status = document.getElementById("status");
const login = document.getElementById("login");
let savedServer;
function showStatus(message, state) {
  status.dataset.state = state;
  status.textContent = message;
}

login.onclick = () => chrome.tabs.create({ url: `${savedServer}/login` });
chrome.storage.local.get("server").then(({ server }) => {
  input.value = server || "";
  if (!server) return;
  try {
    savedServer = serverAddress(server);
    login.hidden = false;
  } catch (error) {
    showStatus(error.message, "error");
  }
}).catch(() => showStatus("Could not load settings. Reopen this page and try again.", "error"));
document.getElementById("settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const submit = document.getElementById("submit");
  submit.disabled = true;
  try {
    const server = serverAddress(input.value);
    // Request permission directly within this user gesture.
    const granted = await chrome.permissions.request({ origins: [hostPermission(server)] });
    if (!granted) throw new Error("Saving articles requires access to this server. Save your settings again and grant access.");
    await chrome.storage.local.set({ server });
    savedServer = server;
    input.value = server;
    login.hidden = false;
    showStatus("Settings saved. Sign in using this Chrome profile, then open a page and click the extension icon.", "saved");
  } catch (error) { showStatus(error.message || "Could not save settings. Try again.", "error"); }
  finally { submit.disabled = false; }
};
