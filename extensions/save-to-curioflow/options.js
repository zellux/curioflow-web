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
}).catch(() => { status.textContent = "Could not load settings. Reopen this page and try again."; });
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
    status.textContent = "Settings saved. Once you’re signed in, return to the article and click the extension icon.";
  } catch (error) { status.textContent = error.message || "Could not save settings. Try again."; }
  finally { submit.disabled = false; }
};
