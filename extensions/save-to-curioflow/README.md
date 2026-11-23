# Save to Curioflow

Save the current page to your Curioflow library from the Chrome or Chromium toolbar. After the save is confirmed, select **Open article** to read it in Curioflow. The extension works with self-hosted servers.

## Install and use

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked** and choose this folder (the one containing `manifest.json`). The extension is ready to load without an npm install or build.
3. Pin **Save to Curioflow** to the toolbar. Click its icon and select **Set server address**.
4. Enter the base URL of your Curioflow server, such as `https://reader.example.com` or `http://192.168.1.20:3000`. Select **Save settings** and grant the requested access.
5. Select **Sign in to Curioflow** and sign in using the same browser profile.
6. Open the page you want to save and click the extension icon or press `Alt+Shift+S`. After saving, select **Open article**. You can change the shortcut at `chrome://extensions/shortcuts`.

The extension stores the server address locally. To change it, select **Settings** in the popup or **Extension options** on the extension's details page. If your reverse proxy uses HTTP Basic Auth, authenticate in the browser before saving.

## Behavior and permissions

- The extension sends the current page URL to `POST /api/urls` using your Curioflow session cookie. There is no extra server setup, token to copy, or password to store in the extension.
- Curioflow fetches and extracts the article on the server. Pages that require a separate website login may be inaccessible to the server. The popup confirms when the URL is saved. Article extraction runs in the background.
- `activeTab` lets the extension read the current page URL when you activate it. `storage` keeps the server address. The extension requests host access for the server you configure and does not read browsing history or inject scripts into pages.
- The service worker handles saves, so the request can continue after you close the popup. It combines identical requests that are already in flight. Reopening the popup checks the save with the server again, and the server deduplicates URLs.
- After 25 seconds, the extension reports that it could not confirm the save. You can retry safely. A browser shutdown or service worker termination can interrupt a request.
- If Curioflow requires you to sign in, the popup links to its sign-in page. Browser cookie settings can prevent the extension from using your session. Network errors, denied permissions, and invalid responses prevent confirmation.
- The extension supports HTTP and HTTPS pages. Browser-internal pages and local `file:` URLs are unsupported.

## Verify

Run these commands from the repository root.

```sh
npm run test:extension
npm run typecheck
npm run lint
```

The automated tests cover save requests and failure handling, URL validation, duplicate in-flight saves, and the popup's success and sign-in flows. Before releasing, load the extension in Chrome and verify first-time permissions, session cookies, saving after closing the popup, browser restarts, and switching servers.

See the [Readwise saving guide](https://docs.readwise.io/reader/docs/saving-content), [Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions), and [Chrome extension storage and cookies guide](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
