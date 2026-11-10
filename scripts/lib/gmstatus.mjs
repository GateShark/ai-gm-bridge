// 0.8.8 GM status pill (listening / thinking / offline / paused).
// 0.8.14: "listening" uses server-confirmed data (user list on other clients,
// last confirmed nonce on the bot's own page). Local heartbeats are not enough.
import { formatOfflineLabel, isLinkFresh } from "./presence.mjs";
export const STATUS_ID = "aigm-gm-status";
export const STATUS_STATES = ["listening", "asleep", "waking", "reading", "thinking", "rolling", "voicing", "speaking", "paused", "offline"];
export const ACTIVITY_STATES = ["asleep", "waking", "reading", "thinking", "rolling", "voicing", "speaking"];
export const STATUS_ALIASES = {
  idle: "listening", ready: "listening", listen: "listening", listening: "listening",
  sleep: "asleep", asleep: "asleep",
  wake: "waking", waking: "waking", wakingup: "waking",
  read: "reading", reading: "reading", claimed: "reading",
  think: "thinking", thinking: "thinking",
  roll: "rolling", rolling: "rolling", requestroll: "rolling",
  voice: "voicing", voicing: "voicing", sendingvoice: "voicing", tts: "voicing",
  speak: "speaking", speaking: "speaking",
  pause: "paused", paused: "paused",
  offline: "offline"
};
export function normalizeGmStatus(raw) {
  if (raw == null || raw === "") return null;
  const k = String(raw).trim().toLowerCase().replace(/[\s_-]+/g, "");
  return STATUS_ALIASES[k] ?? (STATUS_STATES.includes(String(raw).trim()) ? String(raw).trim() : null);
}
export function formatElapsed(since, now = Date.now()) {
  const n = Number(since);
  if (!Number.isFinite(n) || n <= 0) return "";
  const s = Math.max(0, Math.floor((Number(now) - n) / 1000));
  return `${s}s`;
}

export function deriveGmStatus({
  thinking = false, paused = false, enabled = true, botActive = false,
  leaderIsBot = false, lastBeat = 0, now = Date.now(), timeoutMs = 45000,
  lastConfirmed = 0, offlineAfterMs, selfIsBot = false,
  sendingVoice = false, activity = null
} = {}) {
  if (!enabled) return "offline";
  const act = normalizeGmStatus(activity) || (sendingVoice ? "voicing" : null) || (thinking ? "thinking" : null);
  if (act && act !== "listening") return act;
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
      asleep: this.t("AIGM.status.asleep", "GM asleep"),
      waking: this.t("AIGM.status.waking", "GM waking up"),
      reading: this.t("AIGM.status.reading", "GM reading"),
      thinking: this.t("AIGM.status.thinking", "GM thinking…"),
      rolling: this.t("AIGM.status.rolling", "GM requesting a roll"),
      voicing: this.t("AIGM.status.voicing", "GM is sending a voice message…"),
      speaking: this.t("AIGM.status.speaking", "GM speaking"),
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
  set(state, { lastReplyAt, lastSeen, now, since, note } = {}) {
    if (STATUS_STATES.includes(state)) this.state = state;
    if (lastReplyAt !== undefined) this.lastReplyAt = lastReplyAt;
    if (lastSeen !== undefined) this.lastSeen = lastSeen;
    if (now !== undefined) this.now = now;
    if (since !== undefined) this.since = since;
    if (note !== undefined) this.note = note;
    if (!this.el) this.mount();
    this._paint(); return this.state;
  }
  _paint() {
    const el = this.el; if (!el) return;
    const labels = this.labels();
    el.dataset.state = this.state;
    const clock = this.now ?? Date.now();
    let text = this.state === "offline"
      ? formatOfflineLabel(this.lastSeen, clock, this.t)
      : (labels[this.state] || this.state);
    if (ACTIVITY_STATES.includes(this.state)) {
      const elapsed = formatElapsed(this.since, clock);
      if (elapsed) text = `${text} (${elapsed})`;
    }
    el.textContent = text;
    let tip = statusTooltip(this.lastReplyAt, { last: this.t("AIGM.status.lastReply", "Last reply"), none: this.t("AIGM.status.noReply", "No replies yet") });
    if (this.note) tip = tip ? `${tip} — ${this.note}` : String(this.note);
    el.title = tip;
    el.setAttribute?.("aria-label", `${el.textContent}. ${el.title}`);
  }
  remove() { this.el?.remove?.(); this.el = null; }
}
