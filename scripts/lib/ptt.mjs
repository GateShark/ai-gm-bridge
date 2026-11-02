// v0.8.5 push-to-talk: browser Web Speech API -> normal chat message from this user. Client-side only; audio goes
// nowhere except the browser's own speech service. All deps injected so it runs under node tests.
export const DEFAULT_KEY = "Backquote";
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
export class PushToTalk {
  constructor({ win, doc, post, notify, t = (k) => k, lang = "en", key = DEFAULT_KEY, onceNotice = () => true }) {
    Object.assign(this, { win, doc, post, notify, t, lang, key, onceNotice }); this.Ctor = speechCtor(win); this.active = false; this.text = { final: "", interim: "" };
  }
  get available() { return !!this.Ctor; }
  install() {
    if (!this.available) { if (this.onceNotice()) this.notify?.(this.t("AIGM.ptt.unavailable")); return false; }
    this.onDown = (ev) => { if (ev.repeat || !matchesKey(ev, this.key) || isTypingTarget(ev.target ?? this.doc?.activeElement)) return; ev.preventDefault?.(); this.start(); };
    this.onUp = (ev) => { if (matchesKey(ev, this.key) && this.active) { ev.preventDefault?.(); this.stop(); } };
    this.doc.addEventListener("keydown", this.onDown); this.doc.addEventListener("keyup", this.onUp);
    const b = this.button = this.doc.createElement("button"); b.type = "button"; b.id = "aigm-ptt-button"; b.title = this.t("AIGM.ptt.button"); b.textContent = "🎤";
    b.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:100;width:36px;height:36px;border-radius:50%;cursor:pointer";
    const down = (e) => { e.preventDefault?.(); this.start(); }, up = () => this.stop();
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up);
    this.doc.body.appendChild(b); return true;
  }
  uninstall() { this.doc?.removeEventListener?.("keydown", this.onDown); this.doc?.removeEventListener?.("keyup", this.onUp); this.button?.remove?.(); this.button = null; this.stop(true); }
  start() {
    if (this.active || !this.available) return; this.active = true; this.text = { final: "", interim: "" };
    const r = this.rec = new this.Ctor(); r.lang = this.lang; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => { this.text = joinResults(e.results); this.show(); };
    r.onerror = (e) => { if (e?.error === "not-allowed" || e?.error === "service-not-allowed") this.notify?.(this.t("AIGM.ptt.denied")); };
    r.onend = () => this.finish();
    this.show(); try { r.start(); } catch { this.finish(); }
  }
  stop(discard = false) { if (!this.active) return; this.discard = discard; try { this.rec?.stop(); } catch { this.finish(); } }
  async finish() {
    if (!this.rec) return; const text = [this.text.final, this.text.interim].filter(Boolean).join(" ").trim(); const discard = this.discard;
    this.rec = null; this.active = false; this.discard = false; this.hide();
    if (text && !discard) await this.post(text);
  }
  show() {
    let el = this.ind; if (!el) { el = this.ind = this.doc.createElement("div"); el.id = "aigm-ptt-indicator";
      el.style.cssText = "position:fixed;left:52px;bottom:8px;z-index:100;max-width:40vw;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;font-size:13px;pointer-events:none"; this.doc.body.appendChild(el); }
    const live = [this.text.final, this.text.interim].filter(Boolean).join(" ");
    el.textContent = live ? `${this.t("AIGM.ptt.listening")} ${live}` : this.t("AIGM.ptt.listening");
  }
  hide() { this.ind?.remove?.(); this.ind = null; }
}
