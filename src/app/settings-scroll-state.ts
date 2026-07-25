export type SettingsScrollSnapshot = {
  contentHeight: number;
  contentTop: number;
  pathname: string;
  windowTop: number;
};

export function restoredSettingsScrollTop(
  snapshot: Pick<SettingsScrollSnapshot, "contentHeight" | "contentTop">,
  current: { clientHeight: number; scrollHeight: number }
) {
  const heightDelta = current.scrollHeight - snapshot.contentHeight;
  const maximumTop = Math.max(0, current.scrollHeight - current.clientHeight);
  return Math.max(0, Math.min(maximumTop, snapshot.contentTop + heightDelta));
}

export function parseSettingsScrollSnapshot(value: string | null): SettingsScrollSnapshot | null {
  if (!value) return null;
  try {
    const snapshot = JSON.parse(value) as Partial<SettingsScrollSnapshot>;
    if (
      typeof snapshot.contentHeight !== "number"
      || !Number.isFinite(snapshot.contentHeight)
      || typeof snapshot.contentTop !== "number"
      || !Number.isFinite(snapshot.contentTop)
      || typeof snapshot.pathname !== "string"
      || typeof snapshot.windowTop !== "number"
      || !Number.isFinite(snapshot.windowTop)
    ) {
      return null;
    }
    return {
      contentHeight: Math.max(0, snapshot.contentHeight),
      contentTop: Math.max(0, snapshot.contentTop),
      pathname: snapshot.pathname,
      windowTop: Math.max(0, snapshot.windowTop)
    };
  } catch {
    return null;
  }
}
