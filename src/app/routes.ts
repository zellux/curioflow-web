import type { Route } from "next";

export type AppRouteParams = Record<string, string | undefined>;

function cleanQuery(params: AppRouteParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function segment(value: string) {
  return encodeURIComponent(value);
}

export function appHref(params: AppRouteParams): Route {
  const query: AppRouteParams = { ...params };
  let pathname = "/app";

  if (query.settings === "1" || query.view === "settings") {
    delete query.settings;
    delete query.view;
    pathname = "/settings";
  } else if (query.add) {
    const add = query.add;
    delete query.add;
    pathname = `/add/${segment(add)}`;
  } else if (query.item) {
    const item = query.item;
    delete query.item;
    pathname = `/item/${segment(item)}`;
  } else if (query.source) {
    const source = query.source;
    const sourceKind = query.sourceKind ?? query.sourceType;
    delete query.source;
    delete query.sourceKind;
    delete query.sourceType;
    const routeKind = sourceKind === "rss" ? "feed" : sourceKind;
    pathname = routeKind === "feed" || routeKind === "podcast"
      ? `/source/${routeKind}/${segment(source)}`
      : `/source/${segment(source)}`;
  } else if (query.filter === "archive") {
    delete query.filter;
    pathname = "/archive";
  } else if (query.filter === "recent-posts") {
    delete query.filter;
    pathname = "/recent-posts";
  } else if (query.read) {
    const read = query.read;
    delete query.read;
    pathname = `/read/${segment(read)}`;
  } else if (query.status) {
    const status = query.status;
    delete query.status;
    pathname = `/status/${segment(status)}`;
  } else if (query.view === "brief" || query.view === "digest") {
    delete query.view;
    pathname = "/briefing";
  } else if (query.view === "ask") {
    delete query.view;
    pathname = "/ask";
  }

  return `${pathname}${cleanQuery(query)}` as Route;
}
