export function serverAddress(input) {
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error("请输入完整的服务器地址，例如 https://curioflow.example.com"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("服务器地址须使用 HTTP 或 HTTPS，且不能包含账号、密码、查询参数或片段。");
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
    throw new Error("只能保存 HTTP / HTTPS 网页。请打开一篇文章后再试。");
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
    throw new Error("未能确认保存结果。请检查服务器地址和网络，然后重试；重复保存不会新增同一篇文章。");
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "auth", message: "请先在此浏览器登录 Curioflow，再返回文章页面重试。若已登录，请检查浏览器是否阻止扩展使用登录 Cookie。" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || `保存失败（${response.status}），请稍后重试。`);
  if (typeof body?.item?.id !== "string" || !body.item.id) throw new Error("服务器未返回文章 ID，请确认地址指向 Curioflow 服务。");
  return { status: "saved", title: body.item.title || "文章已保存", articleUrl: `${server}/item/${encodeURIComponent(body.item.id)}` };
}
