// 0.8.8 GM status pill (listening / thinking / offline / paused).
// 0.8.14: "listening" uses server-confirmed data (user list on other clients,
// last confirmed nonce on the bot's own page). Local heartbeats are not enough.
import { formatOfflineLabel, isLinkFresh } from "./presence.mjs";
export const STATUS_ID = "aigm-gm-status";
export const STATUS_STATES = ["listening", "thinking", "paused", "offline"];

export function deriveGmStatus({
  thinking = false, paused = false, enabled = true, botActive = false,
  leaderIsBot = false, lastBeat = 0, now = Date.now(), timeoutMs = 45000,
  lastConfirmed = 0, offlineAfterMs, selfIsBot = false
} = {}) {
  if (!enabled) return "offline";
  if (thinking) return "thinking";
  if (paused) return "paused";
  const threshold = offlineAfterMs != null ? offlineAfterMs : timeoutMs;
  if (isLinkFresh({ botActive, lastConfirmed, now, offlineAfterMs: threshold, selfIsBot })) return "listening";
  return "offline";
}

export function formatLastReply(ts, now = Date.now()) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  const ago = Math.max(0, Number(now) - n);
  if (ago < 15_000) return `${hh}:${mm} (just now)`;
  if (ago < 60_000) return `${hh}:${mm} (${Math.round(ago / 1000)}s ago)`;
  if (ago < 3_600_000) return `${hh}:${mm} (${Math.round(ago / 60_000)}m ago)`;
  return `${hh}:${mm}`;
}

export function statusTooltip(lastReplyAt, { now = Date.now(), last = "Last reply", none = "No replies yet" } = {}) {
  const formatted = formatLastReply(lastReplyAt, now);
  return formatted ? `${last}: ${formatted}` : none;
}

export class GmStatusPill {
  constructor({ doc = globalThis.document, t = (k, f) => f || k, onClick = null } = {}) {
    Object.assign(this, { doc, t, onClick }); this.state = "offline"; this.lastReplyAt = null; this.lastSeen = null; this.now = null; this.el = null;
  }
  labels() {
    return {
      listening: this.t("AIGM.status.listening", "GM listening"),
      thinking: this.t("AIGM.status.thinking", "GM thinking…"),
      paused: this.t("AIGM.status.paused", "GM paused"),
      offline: this.t("AIGM.status.offline", "AI GM offline")
    };
  }
  mount() {
    if (!this.doc?.body) return null;
    let el = this.doc.getElementById(STATUS_ID);
    if (!el) {
      el = this.doc.createElement("div"); el.id = STATUS_ID;
      el.setAttribute?.("role", "status"); el.setAttribute?.("aria-live", "polite");
      el.addEventListener?.("click", () => {
        const tip = el.title; if (tip) this.onClick?.(tip, this.state);
      });
      this.doc.body.appendChild(el);
    }
    this.el = el; this._paint(); return el;
  }
  set(state, { lastReplyAt, lastSeen, now } = {}) {
    if (STATUS_STATES.includes(state)) this.state = state;
    if (lastReplyAt !== undefined) this.lastReplyAt = lastReplyAt;
    if (lastSeen !== undefined) this.lastSeen = lastSeen;
    if (now !== undefined) this.now = now;
    if (!this.el) this.mount();
    this._paint(); return this.state;
  }
  _paint() {
    const el = this.el; if (!el) return;
    const labels = this.labels();
    el.dataset.state = this.state;
    const clock = this.now ?? Date.now();
    el.textContent = this.state === "offline"
      ? formatOfflineLabel(this.lastSeen, clock, this.t)
      : (labels[this.state] || this.state);
    el.title = statusTooltip(this.lastReplyAt, { last: this.t("AIGM.status.lastReply", "Last reply"), none: this.t("AIGM.status.noReply", "No replies yet") });
    el.setAttribute?.("aria-label", `${el.textContent}. ${el.title}`);
  }
  remove() { this.el?.remove?.(); this.el = null; }
}
