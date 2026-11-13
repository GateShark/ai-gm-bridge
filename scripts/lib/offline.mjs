// 0.8.20 #11: what a player sees while the AI GM is away. Pure; uses only data the page already has (the
// server-synced user list and the bot's own linkProbe heartbeat setting). No network calls from player browsers.
//   online        - link fresh
//   reconnecting  - link stale for less than notifyAfterMs: "AI GM reconnecting, your message is saved"
//   offline       - stale for notifyAfterMs or more: "AI GM offline, the host has been notified"
// "Saved" is true: the chat message is in Foundry and the leader keeps its wake event queued for the bot.
export const DEFAULT_OFFLINE_NOTIFY_MS = 180000;
export function resolveNotifyAfterMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OFFLINE_NOTIFY_MS;
  return Math.max(30000, Math.min(1800000, Math.round(n)));
}
export function offlinePhase({ fresh = false, lastSeen = 0, staleSince = 0, now = Date.now(), notifyAfterMs = DEFAULT_OFFLINE_NOTIFY_MS } = {}) {
  if (fresh) return "online";
  const since = Number(lastSeen) > 0 ? Number(lastSeen) : (Number(staleSince) || 0); // last heartbeat, else when this page noticed
  if (!since) return "reconnecting";
  return (Number(now) - since) >= resolveNotifyAfterMs(notifyAfterMs) ? "offline" : "reconnecting";
}
// Tracks when this page first saw the link go stale (for a bot that was never seen at all).
export class OfflineWatch {
  constructor() { this.staleSince = 0; this.noticeFor = null; }
  update(fresh, now = Date.now()) { if (fresh) { this.staleSince = 0; this.noticeFor = null; } else if (!this.staleSince) this.staleSince = now; return this.staleSince; }
  // One notice per phase per outage when a player posts while the GM is away.
  noticeOnSend(phase) {
    if (phase === "online") return null;
    if (this.noticeFor === phase) return null;
    this.noticeFor = phase; return phase;
  }
}
export function offlineNotice(phase, t = (k, f) => f || k) {
  if (phase === "reconnecting") return t("AIGM.status.reconnectingSaved", "AI GM reconnecting, your message is saved.");
  if (phase === "offline") return t("AIGM.status.offlineNotified", "AI GM offline, the host has been notified. Your message is saved.");
  return "";
}
