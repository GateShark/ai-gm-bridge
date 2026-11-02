// #14 "GM is thinking…" pill: shown on every client once a player message/roll batch has been sent to the bot,
// cleared by the bot's next chat message, voice line or command, or after a timeout. Not a chat message.
export const THINKING_ID = "aigm-thinking";
export const WAKE_TYPES = ["chat", "rollResult"];
// Only first sends of batches that hold a player message or roll; retries and turn/debug events don't show it.
export const shouldShowThinking = (events = [], attempt = 1) => attempt === 1 && events.some(e => WAKE_TYPES.includes(e?.type));

export class ThinkingIndicator {
  constructor({ doc = globalThis.document, label = () => "GM is thinking…", setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t), now = () => Date.now() } = {}) {
    Object.assign(this, { doc, label, setT, clearT, now }); this.timer = null; this.deadline = null;
  }
  get visible() { return !!this.doc?.getElementById?.(THINKING_ID); }
  show(timeoutMs = 90000) {
    if (!this.doc?.body) return false;
    let el = this.doc.getElementById(THINKING_ID);
    if (!el) {
      el = this.doc.createElement("div"); el.id = THINKING_ID; el.setAttribute?.("role", "status"); el.setAttribute?.("aria-live", "polite");
      el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:10000;padding:6px 14px;border-radius:999px;background:rgba(20,20,20,.85);color:#eee;font-size:14px;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.4)";
      this.doc.body.appendChild(el);
    }
    el.textContent = typeof this.label === "function" ? this.label() : this.label;
    // v0.8.6: the timeout runs from the FIRST show; later shows (queued messages) never push the deadline out.
    const ms = Number(timeoutMs), now = this.now();
    if (!(ms > 0)) { if (this.timer) this.clearT(this.timer); this.timer = null; this.deadline = null; return true; }
    this.deadline = this.deadline == null ? now + ms : Math.min(this.deadline, now + ms);
    if (this.timer) this.clearT(this.timer);
    this.timer = this.setT(() => this.hide(), Math.max(0, this.deadline - now));
    return true;
  }
  hide() {
    if (this.timer) this.clearT(this.timer); this.timer = null; this.deadline = null;
    const el = this.doc?.getElementById?.(THINKING_ID); if (el) { el.remove(); return true; } return false;
  }
}
