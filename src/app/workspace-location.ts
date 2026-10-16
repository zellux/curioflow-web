import type { AppRouteParams } from "@/app/routes";

// Layouts persist across navigations. Resolve their active state from the URL
// on the client rather than freezing page-specific props in a shared layout.
export function workspaceLocation(pathname: string, search: string): AppRouteParams {
  const segments = pathname.split("/").filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  const [route, kind, id] = segments;
  let params: AppRouteParams = {};
  if (route === "item") params = { item: kind };
  else if (route === "archive") params = { filter: "archive" };
  else if (route === "recent-posts" || (route === "source" && kind === "feed" && id === "recent")) params = { filter: "recent-posts" };
  else if (route === "newsletters") params = { filter: "newsletters" };
  else if (route === "source") params = id ? { source: id, sourceKind: kind } : { source: kind };
  else if (route === "briefing") params = { view: "brief" };
  else if (route === "ask" || route === "debug") params = { view: route };
  else if (route === "settings") params = { settings: "1" };
  else if (route === "add") params = { add: kind };
  else if (route === "status") params = { status: kind };
  else if (route === "read") params = { read: kind };
  // Match the server pages' handling of legacy query-based routes.
  return { ...params, ...Object.fromEntries(new URLSearchParams(search)) };
}
