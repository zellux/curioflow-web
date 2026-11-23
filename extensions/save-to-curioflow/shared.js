export function serverAddress(input) {
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter the full HTTPS server address, such as https://curioflow.example.com."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTPS server address without credentials, a query string, or a fragment.");
  }
  return url.href.replace(/\/+$/, "");
}

export function hostPermission(server) {
  const url = new URL(server);
  return `${url.protocol}//${url.hostname}/*`;
}

export function pageAddress(input) {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Open an HTTP or HTTPS page and try again.");
  }
  return url.href;
}

export async function savePage(server, url, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${server}/api/urls`, {
      method: "POST", credentials: "include", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(25000)
    });
  } catch {
    throw new Error("Could not confirm the save. Check your server address and network connection, then try again. Retrying won’t create a duplicate.");
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "auth", message: "Sign in to Curioflow in this browser, then return to the article and try again. If you’re already signed in, check whether your browser is blocking the extension’s access to the session cookie." };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || `Could not save (HTTP ${response.status}). Try again later.`);
  if (typeof body?.item?.id !== "string" || !body.item.id) throw new Error("The server did not return an article ID. Check that the address points to your Curioflow server.");
  return { status: "saved", title: body.item.title || "Article saved", articleUrl: `${server}/item/${encodeURIComponent(body.item.id)}` };
}
