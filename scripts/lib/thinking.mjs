// #14 "GM is thinking…" pill: shown on every client once a player message/roll batch has been sent to the bot,
// cleared by the bot's next chat message, voice line or command, or after a timeout. Not a chat message.
export const THINKING_ID = "aigm-thinking";
export const WAKE_TYPES = ["chat", "rollResult"];
// Only first sends of batches that hold a player message or roll; retries and turn/debug events don't show it.
export const shouldShowThinking = (events = [], attempt = 1) => attempt === 1 && events.some(e => WAKE_TYPES.includes(e?.type));

export class ThinkingIndicator {
  constructor({ doc = globalThis.document, label = () => "GM is thinking…", setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t), now = () => Date.now(), silent = false, onChange = null } = {}) {
    Object.assign(this, { doc, label, setT, clearT, now, silent, onChange }); this.timer = null; this.deadline = null; this._on = false; this.kind = "thinking"; this.note = null; this.since = null;
  }
  get visible() { return this.silent ? !!this._on : !!this.doc?.getElementById?.(THINKING_ID); }
  show(timeoutMs = 90000, { kind = "thinking", note = null } = {}) {
    const prevKind = this.kind;
    this.kind = kind || "thinking";
    this.note = note ?? null;
    if (prevKind !== this.kind || this.since == null) this.since = this.now();
    this._on = true;
    if (!this.silent) {
      if (!this.doc?.body) return false;
      let el = this.doc.getElementById(THINKING_ID);
      if (!el) {
        el = this.doc.createElement("div"); el.id = THINKING_ID; el.setAttribute?.("role", "status"); el.setAttribute?.("aria-live", "polite");
        el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:10000;padding:6px 14px;border-radius:999px;background:rgba(20,20,20,.85);color:#eee;font-size:14px;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.4)";
        this.doc.body.appendChild(el);
      }
      el.textContent = typeof this.label === "function" ? this.label() : this.label;
    }
    // Same kind: keep the earlier deadline (queued messages do not stretch it). A new kind resets the timeout.
    const ms = Number(timeoutMs), now = this.now();
    if (!(ms > 0)) { if (this.timer) this.clearT(this.timer); this.timer = null; this.deadline = null; this.onChange?.("show"); return true; }
    if (prevKind !== this.kind || this.deadline == null) this.deadline = now + ms;
    else this.deadline = Math.min(this.deadline, now + ms);
    if (this.timer) this.clearT(this.timer);
    this.timer = this.setT(() => this.hide(), Math.max(0, this.deadline - now));
    this.onChange?.("show");
    return true;
  }
  hide() {
    if (this.timer) this.clearT(this.timer); this.timer = null; this.deadline = null; this.kind = "thinking"; this.note = null; this.since = null;
    if (this.silent) {
      const was = this._on; this._on = false;
      if (was) this.onChange?.("hide");
      return was;
    }
    this._on = false;
    const el = this.doc?.getElementById?.(THINKING_ID); if (el) { el.remove(); this.onChange?.("hide"); return true; } return false;
  }
}
