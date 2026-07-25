export const OPEN_SETTINGS_EVENT = "curioflow:open-settings";

export function isSettingsOverlayHref(href: string) {
  const url = new URL(href, "http://localhost");
  return url.pathname === "/settings" || url.searchParams.get("settings") === "1";
}

export function settingsOverlayHref(href: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("settings", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
