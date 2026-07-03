export function safeReturnTo(value: string | null | undefined, fallback = "/home") {
  const returnTo = String(value ?? "");
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.startsWith("/login")) {
    return fallback;
  }
  return returnTo;
}
