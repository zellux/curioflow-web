const MOBILE_SESSION_PATHS = new Set([
  "/api/mobile/session",
  "/api/mobile/v1/session"
]);

const MOBILE_SESSION_METHODS = new Set(["GET", "POST", "DELETE"]);

export function isPublicMobileSessionRequest(pathname: string, method: string) {
  return MOBILE_SESSION_PATHS.has(pathname) && MOBILE_SESSION_METHODS.has(method.toUpperCase());
}
