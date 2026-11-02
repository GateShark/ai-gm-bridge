// Bounded processed-id ring. Statuses: claimed | sent | acked | failed. Only "acked"/"sent" block re-sending;
// "failed" or expired "claimed" may be retried (fixes false-duplicate drops).
export class DedupeStore {
  constructor({ max = 2000, claimTtlMs = 90000, entries = [] } = {}) {
    this.max = max; this.ttl = claimTtlMs; this.map = new Map(entries);
  }
  claim(id, now) {
    const e = this.map.get(id);
    if (e && (e.s === "sent" || e.s === "acked")) return false;
    if (e && e.s === "claimed" && now - e.t < this.ttl) return false;
    this._set(id, { s: "claimed", t: now }); return true;
  }
  mark(id, status, now, extra) { this._set(id, { ...(this.map.get(id) || {}), ...extra, s: status, t: now }); }
  release(id, now) { this.mark(id, "failed", now); }
  get(id) { return this.map.get(id); }
  has(id) { return this.map.has(id); }
  _set(id, v) { this.map.delete(id); this.map.set(id, v); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  toJSON() { return [...this.map.entries()]; }
}
