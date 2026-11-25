// Fired when an item's read state changes outside a server action, so views that
// show unread counts (the sidebar) know their data is stale.
export const READ_STATE_CHANGED_EVENT = "curioflow:read-state-changed";

export function notifyReadStateChanged() {
  window.dispatchEvent(new Event(READ_STATE_CHANGED_EVENT));
}
