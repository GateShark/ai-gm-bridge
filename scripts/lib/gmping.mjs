// 0.9.8 "AI GM" status badge: a small draggable readout like Foundry's ping/FPS line, for the AI GM:
//   AI GM · 140 ms · reply 18 s · seen 2 s ago      (a coloured dot in front)
// Fully passive: every number comes from traffic that already happens (the batch POST, the bot's commands and acks, the chat).
// The leader client measures; the world setting "gmPing" carries the numbers to everyone (written at most once per 5 s, only when
// something changed). No secrets and no URLs are ever put in the snapshot or in the diagnostics text.
import { applyPttPosition, PTT_DRAG_PX } from "./ptt.mjs";

export const GMPING_FRESH_MS = 60000;      // seen within a minute and nothing older than a minute waiting: green
export const GMPING_STALE_MS = 300000;     // seen 1-5 minutes ago, or an event waiting 1+ minute: yellow; more than 5 minutes: red
export const GMPING_PUBLISH_MS = 5000;     // the leader writes the shared numbers at most this often
export const GMPING_KEEP = 5;              // reply times kept (the tooltip shows them)
export const GMPING_ID = "aigm-gm-ping";
export const REPLY_COMMANDS = ["post", "postVoice", "whisper"];

// ---------- formatting ----------
export function fmtMs(ms) { const n = Number(ms); if (!Number.isFinite(n) || n < 0) return ""; return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`; }
export function fmtSecs(ms) { const n = Number(ms); if (!Number.isFinite(n) || n < 0) return ""; const s = Math.round(n / 1000); return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`; }
export function fmtAgo(ts, now = Date.now()) {
  const n = Number(ts); if (!Number.isFinite(n) || n <= 0) return "";
  const s = Math.max(0, Math.round((Number(now) - n) / 1000));
  if (s < 90) return `${s} s ago`; if (s < 5400) return `${Math.round(s / 60)} min ago`; return `${Math.round(s / 3600)} h ago`;
}
// text for strings that may carry an address or token: URLs and long token-like runs are removed
export function scrub(s, max = 160) {
  return String(s ?? "").replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").replace(/\b[A-Za-z0-9_\-+/=]{24,}\b/g, "[hidden]").replace(/\s+/g, " ").trim().slice(0, max);
}

// ---------- reply time: the first player chat line in a batch -> the next GM post / postVoice that answers it ----------
export class ReplyTimes {
  constructor({ keep = GMPING_KEEP, openMax = 20, openTtlMs = 600000 } = {}) { Object.assign(this, { keep, openMax, openTtlMs }); this.open = []; this.times = []; }
  // events: the batch's events (chat events are the player lines). firstAt = when the oldest of those lines was typed.
  openBatch(events = [], now = Date.now()) {
    const chats = (events ?? []).filter(e => e?.type === "chat" && !e?.fromBot);
    if (!chats.length) return false;
    const ats = chats.map(e => Number(e.firstAt ?? e.at ?? e.ts ?? now)).filter(Number.isFinite);
    this.open.push({ at: ats.length ? Math.min(...ats) : now, ids: chats.map(e => e.eventId).filter(Boolean) });
    while (this.open.length > this.openMax) this.open.shift();
    return true;
  }
  // a GM post answered something: close the batch it answers (by replyTo when it names one, else the oldest open one)
  reply(now = Date.now(), replyTo = null) {
    this.open = this.open.filter(o => now - o.at < this.openTtlMs);
    if (!this.open.length) return null;
    let i = 0; const r = replyTo ? String(replyTo) : "";
    if (r) { const j = this.open.findIndex(o => o.ids.some(id => id === r || id === `chat:${r.replace(/^chat:/, "")}`)); if (j >= 0) i = j; }
    const [b] = this.open.splice(i, 1);
    const ms = Math.max(0, now - b.at);
    this.times.push(ms); while (this.times.length > this.keep) this.times.shift();
    return ms;
  }
  // 0.9.9: after a restart of the leader's session the new leader starts with an empty list, which used to be published over the
  // shared numbers (the badge lost "reply N s" until the next reply). seed() takes the last published times (world setting gmPing) once,
  // oldest first, in front of anything measured since; only finite non-negative numbers are accepted. Returns true when it added any.
  seed(stored) {
    if (this.seeded) return false; this.seeded = true;
    const old = (Array.isArray(stored) ? stored : []).map(Number).filter(n => Number.isFinite(n) && n >= 0).map(Math.round);
    if (!old.length) return false;
    this.times = [...old, ...this.times].slice(-this.keep); return true;
  }
  get last() { return this.times.length ? this.times[this.times.length - 1] : null; }
  list() { return [...this.times]; }
}

// ---------- dot colour ----------
// red: off, offline or not receiving, or not seen for 5+ minutes. yellow: seen 1-5 minutes ago, or an event has waited 1+ minute.
// green: seen under a minute ago and nothing waiting longer than a minute.
export function pingDot({ enabled = true, offline = false, notReceiving = false, seenAt = 0, oldestWaitingAt = null, now = Date.now() } = {}) {
  if (!enabled || offline || notReceiving) return "red";
  const seenAge = seenAt > 0 ? now - seenAt : Infinity;
  if (seenAge >= GMPING_STALE_MS) return "red";
  const waited = oldestWaitingAt != null ? now - oldestWaitingAt : 0;
  if (seenAge >= GMPING_FRESH_MS || waited >= GMPING_FRESH_MS) return "yellow";
  return "green";
}

// ---------- the shared snapshot (what the leader publishes; no secrets) ----------
export function buildSnapshot({ now = Date.now(), seenAt = 0, webhookMs = null, replies = [], queued = 0, oldestWaitingAt = null, mode = "relay", notReceiving = false, lastError = "", version = "" } = {}) {
  const r = (replies ?? []).filter(Number.isFinite).slice(-GMPING_KEEP).map(Math.round);
  return { seenAt: seenAt || 0, webhookMs: Number.isFinite(webhookMs) ? Math.round(webhookMs) : null, replies: r, queued: Math.max(0, queued | 0), oldestWaitingAt: oldestWaitingAt ?? null,
    mode: mode === "direct" ? "webhook" : "relay", notReceiving: !!notReceiving, lastError: scrub(lastError, 120), version: String(version || "") };
}
// the reply times of the snapshot that is already published (or [] for anything that is not one)
export const storedReplies = (snap) => (Array.isArray(snap?.replies) ? snap.replies : []);
export const sameSnapshot = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// the leader's throttled publisher: write() is called at most once per everyMs, only when the snapshot changed; the last change is never lost
export function createPublisher({ write, everyMs = GMPING_PUBLISH_MS, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms) } = {}) {
  let last = null, lastAt = -Infinity, pending = null, timer = null;
  const fire = () => { timer = null; if (pending && !sameSnapshot(pending, last)) { last = pending; lastAt = now(); try { write(pending); } catch {} } pending = null; };
  return { push(snap) {
    if (sameSnapshot(snap, last)) { pending = null; return false; }
    const wait = lastAt + everyMs - now();
    if (wait <= 0) { pending = snap; if (timer) { try { clearTimeout(timer); } catch {} timer = null; } fire(); return true; }
    pending = snap; if (!timer) timer = setTimer(fire, wait); return false;
  }, get last() { return last; } };
}

// ---------- the line, the tooltip, the diagnostics ----------
export function rowParts({ snap = null, state = "listening", seenAt = 0, now = Date.now() } = {}) {
  const parts = ["AI GM"];
  if (state === "offline" || state === "reconnecting") parts.push(state === "reconnecting" ? "reconnecting" : "offline");
  else if (state === "paused") parts.push("paused");
  else if (snap?.webhookMs != null) parts.push(fmtMs(snap.webhookMs));
  if (snap?.replies?.length) parts.push(`reply ${fmtSecs(snap.replies[snap.replies.length - 1])}`);
  const ago = fmtAgo(seenAt, now); parts.push(ago ? `seen ${ago}` : "not seen yet");
  return parts;
}
export const rowText = (o) => rowParts(o).join(" · ");
export function detailLines({ snap = null, state = "listening", seenAt = 0, now = Date.now(), version = "" } = {}) {
  const l = [];
  l.push(`Status: ${state}`);
  l.push(`Connection: ${snap?.mode === "webhook" ? "webhook (direct)" : "relay"}`);
  l.push(snap?.webhookMs != null ? `Webhook accepted the last batch in ${fmtMs(snap.webhookMs)}` : "Webhook time: not measured (relay mode, or nothing sent yet)");
  l.push(`Undelivered events: ${snap?.queued ?? 0}${snap?.oldestWaitingAt ? ` (oldest waiting ${fmtSecs(now - snap.oldestWaitingAt)})` : ""}`);
  l.push(snap?.replies?.length ? `Last replies: ${snap.replies.map(fmtSecs).join(", ")}` : "Last replies: none yet");
  l.push(`Last seen: ${fmtAgo(seenAt, now) || "never"}`);
  if (snap?.notReceiving) l.push("The bot is not receiving events (see docs/SETUP.md, Troubleshooting)");
  if (snap?.lastError) l.push(`Last error: ${snap.lastError}`);
  l.push(`Add-on version: ${version || snap?.version || "unknown"}`);
  return l;
}
export function diagnosticsText(o = {}) {
  return ["AI GM Pirate Borg diagnostics", ...detailLines(o), `Line: ${rowText(o)}`, `Time: ${new Date(o.now ?? Date.now()).toISOString()}`].map(x => scrub(x, 240)).join("\n");
}

// ---------- visibility and position ----------
// world setting "Allow AI GM status row" (GM) and client setting "Show AI GM status" (each user); the bot's own browser never shows it
export const shouldShow = ({ enabled = true, allow = true, show = true, isBot = false } = {}) => !!(enabled && allow && show && !isBot);
export function clampBox(x, y, { vw = 800, vh = 600, w = 160, h = 24 } = {}) {
  const maxX = Math.max(0, (Number(vw) || 800) - (Number(w) || 0)); const maxY = Math.max(0, (Number(vh) || 600) - (Number(h) || 0));
  return { x: Math.min(maxX, Math.max(0, Number(x) || 0)), y: Math.min(maxY, Math.max(0, Number(y) || 0)) };
}
// default spot: just above the Players list (like the ping/FPS line); otherwise bottom left above the push-to-talk button
export function defaultPosition({ playersRect = null, vw = 800, vh = 600, w = 160, h = 24 } = {}) {
  if (playersRect && Number.isFinite(playersRect.top) && Number.isFinite(playersRect.left) && playersRect.width > 0) return clampBox(playersRect.left, playersRect.top - h - 4, { vw, vh, w, h });
  return clampBox(12, vh - 48 - 12 - h - 8, { vw, vh, w, h });
}

// ---------- drag (the push-to-talk gesture: a move of PTT_DRAG_PX or more is a drag, anything less is a click) ----------
export function attachDrag(el, { doc, win, onMove = null, onClick = null, onDblClick = null, size = () => ({ w: el.offsetWidth || 160, h: el.offsetHeight || 24 }) } = {}) {
  let press = null, dragged = false;
  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    const r = el.getBoundingClientRect?.() ?? {};
    const sl = parseFloat(el.style?.left), st = parseFloat(el.style?.top);
    press = { x: e.clientX ?? 0, y: e.clientY ?? 0, dragging: false, ox: Number.isFinite(sl) ? sl : (r.left ?? 0), oy: Number.isFinite(st) ? st : (r.top ?? 0), last: null };
    dragged = false;
  };
  const move = (e) => {
    if (!press) return;
    const dx = (e.clientX ?? 0) - press.x, dy = (e.clientY ?? 0) - press.y;
    if (!press.dragging && (dx * dx + dy * dy) >= PTT_DRAG_PX * PTT_DRAG_PX) { press.dragging = true; dragged = true; el.dataset.dragging = "1"; }
    if (press.dragging) { const s = size(); const pos = clampBox(press.ox + dx, press.oy + dy, { vw: win?.innerWidth, vh: win?.innerHeight, ...s }); applyPttPosition(el, pos); press.last = pos; }
  };
  const up = () => {
    if (!press) return;
    const was = press; press = null; delete el.dataset.dragging;
    if (was.dragging) { if (was.last) onMove?.(was.last); } else onClick?.();
  };
  const click = (e) => { if (dragged) { e.preventDefault?.(); e.stopPropagation?.(); dragged = false; } }; // a drag is never a click
  el.addEventListener("pointerdown", down); el.addEventListener("dblclick", () => { onDblClick?.(); });
  el.addEventListener("click", click);
  const upTarget = doc ?? el; // the release can happen outside the badge while dragging
  doc?.addEventListener?.("pointermove", move); upTarget.addEventListener("pointerup", up);
  return { detach() { doc?.removeEventListener?.("pointermove", move); upTarget.removeEventListener?.("pointerup", up); } };
}

// ---------- the badge ----------
export class GmPingBadge {
  constructor({ doc = globalThis.document, win = globalThis.window, t = (k, f) => f || k, isGM = false, position = null, onMove = null, onReset = null, onHide = null, onCopy = null, playersRect = () => null } = {}) {
    Object.assign(this, { doc, win, t, isGM, position, onMove, onReset, onHide, onCopy, playersRect });
    this.el = null; this.text = null; this.pop = null; this.model = null;
  }
  mount() {
    if (!this.doc?.body) return null;
    let el = this.doc.getElementById(GMPING_ID); if (el) { this.el = el; return el; }
    el = this.doc.createElement("div"); el.id = GMPING_ID; el.className = "aigm-ping";
    el.setAttribute?.("role", "status");
    el.innerHTML = '<span class="aigm-ping-dot" aria-hidden="true"></span><span class="aigm-ping-text"></span><button type="button" class="aigm-ping-eye" aria-label="Hide AI GM status">👁</button>';
    this.el = el; this.text = el.querySelector?.(".aigm-ping-text");
    const eye = el.querySelector?.(".aigm-ping-eye");
    eye?.addEventListener("pointerdown", (e) => e.stopPropagation?.());
    eye?.addEventListener("click", (e) => { e.preventDefault?.(); e.stopPropagation?.(); try { this.onHide?.(); } catch {} });
    this.drag = attachDrag(el, { doc: this.doc, win: this.win,
      onMove: (pos) => { this.position = pos; try { this.onMove?.(pos); } catch {} },
      onClick: () => { if (this.isGM) this.togglePopover(); },
      onDblClick: () => { try { this.onReset?.(); } catch {} this.place(true); } });
    this.doc.body.appendChild(el); this.place(); return el;
  }
  size() { return { w: this.el?.offsetWidth || 190, h: this.el?.offsetHeight || 24 }; }
  // saved spot (clamped so it stays on screen), else just above the Players list
  place(reset = false) {
    if (!this.el) return null;
    if (reset) this.position = null;
    try { return this._place(); } catch { return null; } // 0.9.9: layout reads can fail while the page is rebuilding
  }
  _place() {
    const s = this.size(), vw = this.win?.innerWidth, vh = this.win?.innerHeight;
    const pos = this.position?.x != null && this.position?.y != null ? clampBox(this.position.x, this.position.y, { vw, vh, ...s })
      : defaultPosition({ playersRect: this.playersRect?.() ?? null, vw, vh, ...s });
    applyPttPosition(this.el, pos); return pos;
  }
  set(model) {
    this.model = model; if (!this.el) this.mount(); if (!this.el) return;
    const { dot, text, title } = model;
    this.el.dataset.dot = dot; this.el.dataset.hidden = "0";
    if (this.text) this.text.textContent = text;
    this.el.title = this.isGM ? title : text; // only the GM sees the details
    this.el.setAttribute?.("aria-label", `${text}`);
    if (this.pop && this.pop.dataset.open === "1") this.paintPopover();
    this.place();
  }
  togglePopover() {
    if (!this.el) return;
    if (!this.pop) {
      const p = this.pop = this.doc.createElement("div"); p.className = "aigm-ping-pop"; p.dataset.open = "0";
      p.innerHTML = '<pre class="aigm-ping-lines"></pre><div class="aigm-ping-actions"><button type="button" data-act="copy">Copy diagnostics</button> <button type="button" data-act="reset">Reset position</button> <button type="button" data-act="hide">Hide</button></div>';
      p.addEventListener("pointerdown", (e) => e.stopPropagation?.());
      p.addEventListener("click", (e) => {
        const act = e.target?.dataset?.act; if (!act) return;
        if (act === "copy") { try { this.onCopy?.(this.model?.diagnostics ?? ""); } catch {} }
        else if (act === "reset") { try { this.onReset?.(); } catch {} this.place(true); }
        else if (act === "hide") { try { this.onHide?.(); } catch {} }
      });
      this.el.appendChild(p);
    }
    const open = this.pop.dataset.open !== "1"; this.pop.dataset.open = open ? "1" : "0"; this.pop.hidden = !open; if (open) this.paintPopover();
    return open;
  }
  paintPopover() { const pre = this.pop?.querySelector?.(".aigm-ping-lines"); if (pre) pre.textContent = (this.model?.lines ?? []).join("\n"); }
  hide() { if (this.el) { this.el.dataset.hidden = "1"; } }
  remove() { try { this.drag?.detach(); } catch {} this.el?.remove?.(); this.el = null; this.text = null; this.pop = null; }
}

// everything a refresh needs, in one pure call
export function buildModel({ snap = null, state = "listening", seenAt = 0, now = Date.now(), enabled = true, offline = false, version = "" } = {}) {
  const dot = pingDot({ enabled, offline: offline || state === "offline" || state === "reconnecting", notReceiving: !!snap?.notReceiving, seenAt, oldestWaitingAt: snap?.oldestWaitingAt ?? null, now });
  const o = { snap, state, seenAt, now, version };
  const lines = detailLines(o);
  return { dot, text: rowText(o), lines, title: lines.join("\n"), diagnostics: diagnosticsText(o) };
}
