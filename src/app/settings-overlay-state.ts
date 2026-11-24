export const OPEN_SETTINGS_EVENT = "curioflow:open-settings";

export function isSettingsOverlayHref(href: string) {
  const url = new URL(href, "http://localhost");
  return url.pathname === "/settings" || url.searchParams.has("settings");
}

export function isNewsletterSettingsHref(href: string) {
  const url = new URL(href, "http://localhost");
  const settings = url.searchParams.get("settings");
  return settings === "newsletter"
    || (settings === "import" && url.hash === "#import-newsletter")
    || (isSettingsOverlayHref(href) && url.searchParams.get("settingsTab") === "newsletter");
}

export function settingsOverlayHref(href: string, tab?: "newsletter") {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("settings", tab ?? "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
