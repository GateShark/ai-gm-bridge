// Event-driven debounce: one flush per burst. Flush when the chat is quiet for debounceMs, or maxWaitMs after the
// first event, or at once for urgent events (direct mention/whisper). No polling: one timer only while events wait.
export class Batcher {
  constructor({ debounceMs = 1200, maxWaitMs = 3500, onFlush, setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t), now = Date.now }) {
    Object.assign(this, { debounceMs, maxWaitMs, onFlush, setT, clearT, now }); this.first = null; this.timer = null; this.rtimer = null; this.rdue = null;
  }
  // at = the event's enqueue time; the cap is measured from the earliest pending event, never from a later re-arm.
  push({ urgent = false, at } = {}) {
    const t = this.now(); const e = at ?? t; if (this.first === null || e < this.first) this.first = e;
    if (urgent) return this.fire();
    const wait = Math.min(this.debounceMs, this.first + this.maxWaitMs - t);
    if (wait <= 0) return this.fire(); // cap already reached: send now, don't trust a (possibly throttled) 0 ms timer
    if (this.timer) this.clearT(this.timer);
    this.timer = this.setT(() => this.fire(), wait);
  }
  // Catch-up from any other event (heartbeat, hooks): background tabs throttle timers, so enforce the cap here too.
  check() { if (this.first !== null && this.now() >= this.first + this.maxWaitMs) this.fire(); }
  // Retry wake (backoff) on its own timer: never shortens or cancels an open burst.
  at(when) {
    if (when == null) return; const w = Math.max(0, when - this.now());
    if (this.rtimer && this.rdue != null && this.rdue <= when) return;
    if (this.rtimer) this.clearT(this.rtimer);
    this.rdue = when; this.rtimer = this.setT(() => { this.rtimer = null; this.rdue = null; this.onFlush?.({ retry: true, burstOpen: this.first !== null }); }, w);
  }
  get pending() { return this.first !== null; }
  fire() { if (this.timer) this.clearT(this.timer); this.timer = null; const first = this.first; this.first = null; this.onFlush?.({ retry: false, first }); }
  stop() { if (this.timer) this.clearT(this.timer); if (this.rtimer) this.clearT(this.rtimer); this.timer = this.rtimer = null; this.rdue = null; this.first = null; }
}
