// v0.8.5 push-to-talk: browser Web Speech API -> normal chat message from this user. Client-side only; audio goes
// nowhere except the browser's own speech service. All deps injected so it runs under node tests.
export const DEFAULT_KEY = "Backquote";
export const PTT_DRAG_PX = 8;
export const speechCtor = (win) => win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
export function isTypingTarget(el) {
  if (!el) return false; const t = String(el.tagName ?? "").toUpperCase();
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable === true;
}
// Key setting accepts a KeyboardEvent.code ("Backquote", "KeyV", "F2") or a literal key ("`").
export function matchesKey(ev, key = DEFAULT_KEY) { const k = String(key || DEFAULT_KEY); return ev?.code === k || ev?.key === k; }
// Foundry language ("en", "pt-BR") -> BCP-47 for SpeechRecognition; falls back to the browser language.
export const speechLang = (foundryLang, navLang) => String(foundryLang || navLang || "en").replace("_", "-");
export function joinResults(results) {
  let final = "", interim = "";
  for (const r of Array.from(results ?? [])) { const t = r?.[0]?.transcript ?? ""; if (r?.isFinal) final += t; else interim += t; }
  return { final: final.trim(), interim: interim.trim() };
}

export const DEFAULT_SPEECH_HINTS = ["kick", "dropkick", "drop kick", "slash", "parry", "dodge", "block", "strike", "thrust", "shoot", "steal", "sneak", "hide", "attack", "defend", "broken", "agility", "strength", "presence", "toughness", "spirit"];
export const DEFAULT_SPEECH_FIXES = [["drop cake", "dropkick"], ["drop cakes", "dropkick"], ["kik", "kick"], ["perry", "parry"], ["pulled up behind", "ducked behind"]];
export const DEFAULT_SPEECH_HINTS_TEXT = DEFAULT_SPEECH_HINTS.join(", ");
export const DEFAULT_SPEECH_FIXES_TEXT = "drop cake=dropkick, drop cakes=dropkick, kik=kick, perry=parry, pulled up behind=ducked behind";
export function parseSpeechHints(raw) {
  const extra = String(raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const w of [...DEFAULT_SPEECH_HINTS, ...extra]) {
    const k = w.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(w);
  }
  return out;
}
export function parseSpeechFixes(raw) {
  const out = DEFAULT_SPEECH_FIXES.map(([a, b]) => [a, b]);
  for (const part of String(raw ?? "").split(",")) {
    const i = part.indexOf("="); if (i < 1) continue;
    const from = part.slice(0, i).trim(), to = part.slice(i + 1).trim();
    if (from && to) out.push([from, to]);
  }
  return out;
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => { const row = new Array(n + 1); row[0] = i; return row; });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}
export function correctSpeech(text, { hints, fixes } = {}) {
  let s = String(text ?? ""); if (!s) return s;
  const fixList = Array.isArray(fixes) ? fixes : parseSpeechFixes(fixes);
  const hintList = Array.isArray(hints) ? hints : parseSpeechHints(hints);
  for (const [from, to] of fixList) {
    if (!from) continue;
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    s = s.replace(re, (match) => {
      if (match === match.toUpperCase()) return to.toUpperCase();
      if (match[0] === match[0].toUpperCase()) return to.charAt(0).toUpperCase() + to.slice(1);
      return to;
    });
  }
  return s.replace(/\b[\w']+\b/g, (tok) => {
    if (tok.length < 3) return tok;
    const lower = tok.toLowerCase();
    let best = null, bestD = 2;
    for (const h of hintList) {
      if (/\s/.test(h)) continue;
      const hl = h.toLowerCase();
      if (hl === lower) return tok;
      const d = levenshtein(lower, hl);
      if (d <= 1 && d < bestD && hl.length >= 3) { best = h; bestD = d; }
    }
    if (!best) return tok;
    if (tok === tok.toUpperCase()) return best.toUpperCase();
    if (tok[0] === tok[0].toUpperCase() && tok.slice(1) === tok.slice(1).toLowerCase()) return best.charAt(0).toUpperCase() + best.slice(1);
    return best;
  });
}
export function applySpeechGrammar(rec, hints, win) {
  const List = win?.SpeechGrammarList ?? win?.webkitSpeechGrammarList;
  if (!rec || !List || !hints?.length) return false;
  try {
    const list = new List();
    const words = hints.filter(h => h && !/\s/.test(h)).map(h => h.replace(/[;|=<>]/g, "")).filter(Boolean).join(" | ");
    if (!words) return false;
    list.addFromString(`#JSGF V1.0; grammar game; public <term> = ${words} ;`, 1);
    rec.grammars = list; return true;
  } catch { return false; }
}
export function clampPttPosition(x, y, { vw = 800, vh = 600, size = 48 } = {}) {
  const maxX = Math.max(0, (Number(vw) || 800) - size);
  const maxY = Math.max(0, (Number(vh) || 600) - size);
  return { x: Math.min(maxX, Math.max(0, Number(x) || 0)), y: Math.min(maxY, Math.max(0, Number(y) || 0)) };
}
export function applyPttPosition(el, pos) {
  if (!el?.style || !pos || pos.x == null || pos.y == null) return;
  el.style.left = `${pos.x}px`; el.style.top = `${pos.y}px`; el.style.right = "auto"; el.style.bottom = "auto";
}

export class PushToTalk {
  constructor({ win, doc, post, notify, t = (k) => k, lang = "en", key = DEFAULT_KEY, onceNotice = () => true, position = null, onMove = null, logoSrc = "", speechHints = "", speechFixes = "" }) {
    Object.assign(this, { win, doc, post, notify, t, lang, key, onceNotice, position, onMove, logoSrc, speechHints, speechFixes }); this.Ctor = speechCtor(win); this.active = false; this.text = { final: "", interim: "" };
  }
  get available() { return !!this.Ctor; }
  install(opts = {}) {
    const keyboard = opts.keyboard !== false, notifyIfMissing = opts.notifyIfMissing !== false;
    if (!this.available) { if (notifyIfMissing && this.onceNotice()) this.notify?.(this.t("AIGM.ptt.unavailable")); return false; }
    if (keyboard) {
      this.onDown = (ev) => { if (ev.repeat || !matchesKey(ev, this.key) || isTypingTarget(ev.target ?? this.doc?.activeElement)) return; ev.preventDefault?.(); this.start(); };
      this.onUp = (ev) => { if (matchesKey(ev, this.key) && this.active) { ev.preventDefault?.(); this.stop(); } };
      this.doc.addEventListener("keydown", this.onDown); this.doc.addEventListener("keyup", this.onUp);
    } else { this.onDown = null; this.onUp = null; }
    const b = this.button = this.doc.createElement("button"); b.type = "button"; b.id = "aigm-ptt-button"; b.className = "aigm-ptt-btn";
    b.title = this.t("AIGM.ptt.button"); b.setAttribute?.("aria-label", this.t("AIGM.ptt.button"));
    const icon = this.logoSrc
      ? `<img class="aigm-ptt-icon" src="${this.logoSrc}" alt="" draggable="false">`
      : '<span class="aigm-ptt-icon">🎤</span>';
    b.innerHTML = `${icon}<span class="aigm-ptt-dot" aria-hidden="true"></span>`;
    b.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:100;width:48px;height:48px;border-radius:50%;cursor:pointer";
    if (this.position?.x != null && this.position?.y != null) applyPttPosition(b, this.position);
    let press = null;
    const down = (e) => {
      e.preventDefault?.();
      const x = e.clientX ?? 0, y = e.clientY ?? 0;
      const sl = parseFloat(b.style?.left), st = parseFloat(b.style?.top);
      let ox = Number.isFinite(sl) ? sl : 12, oy = Number.isFinite(st) ? st : null;
      if (oy == null) {
        const r = b.getBoundingClientRect?.();
        oy = r && Number.isFinite(r.top) ? r.top : ((this.win?.innerHeight ?? 600) - 60);
        if (r && Number.isFinite(r.left)) ox = r.left;
      }
      press = { x, y, dragging: false, ox, oy, last: null };
      this.start();
    };
    const move = (e) => {
      if (!press) return;
      const dx = (e.clientX ?? 0) - press.x, dy = (e.clientY ?? 0) - press.y;
      if (!press.dragging && (dx * dx + dy * dy) >= PTT_DRAG_PX * PTT_DRAG_PX) {
        press.dragging = true;
        this.stop(true);
        if (this.button) this.button.className = "aigm-ptt-btn aigm-ptt-dragging";
      }
      if (press.dragging) {
        const pos = clampPttPosition(press.ox + dx, press.oy + dy, { vw: this.win?.innerWidth, vh: this.win?.innerHeight });
        applyPttPosition(b, pos);
        press.last = pos;
      }
    };
    const up = () => {
      if (!press) return;
      if (press.dragging) {
        if (press.last) this.onMove?.(press.last);
        if (this.button) this.button.className = "aigm-ptt-btn";
      } else this.stop();
      press = null;
    };
    const leave = () => { if (press && !press.dragging) { this.stop(); press = null; } };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", leave);
    this.doc.addEventListener("pointermove", move);
    this._ptrMove = move; this._ptrUp = up;
    this.doc.body.appendChild(b); return true;
  }
  uninstall() {
    if (this.onDown) this.doc?.removeEventListener?.("keydown", this.onDown);
    if (this.onUp) this.doc?.removeEventListener?.("keyup", this.onUp);
    if (this._ptrMove) this.doc?.removeEventListener?.("pointermove", this._ptrMove);
    this.button?.remove?.(); this.button = null; this.stop(true);
  }
  start() {
    if (this.active || !this.available) return; this.active = true; this.text = { final: "", interim: "" };
    const r = this.rec = new this.Ctor(); r.lang = this.lang; r.continuous = true; r.interimResults = true;
    applySpeechGrammar(r, parseSpeechHints(this.speechHints), this.win);
    r.onresult = (e) => { this.text = joinResults(e.results); this.show(); };
    r.onerror = (e) => { if (e?.error === "not-allowed" || e?.error === "service-not-allowed") this.notify?.(this.t("AIGM.ptt.denied")); };
    r.onend = () => this.finish();
    this.show(); try { r.start(); } catch { this.finish(); }
  }
  stop(discard = false) { if (!this.active) return; this.discard = discard; try { this.rec?.stop(); } catch { this.finish(); } }
  async finish() {
    if (!this.rec) return; const raw = [this.text.final, this.text.interim].filter(Boolean).join(" ").trim(); const discard = this.discard;
    const text = correctSpeech(raw, { hints: this.speechHints, fixes: this.speechFixes });
    this.rec = null; this.active = false; this.discard = false; this.hide();
    if (text && !discard) await this.post(text);
  }
  show() {
    let el = this.ind; if (!el) { el = this.ind = this.doc.createElement("div"); el.id = "aigm-ptt-indicator";
      el.style.cssText = "position:fixed;left:52px;bottom:8px;z-index:100;max-width:40vw;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;font-size:13px;pointer-events:none"; this.doc.body.appendChild(el); }
    const live = [this.text.final, this.text.interim].filter(Boolean).join(" ");
    el.textContent = live ? `${this.t("AIGM.ptt.listening")} ${live}` : this.t("AIGM.ptt.listening");
    if (this.button) this.button.className = "aigm-ptt-btn aigm-ptt-live";
  }
  hide() { if (this.button) this.button.className = "aigm-ptt-btn"; this.ind?.remove?.(); this.ind = null; }
}
