// Latency/usage counters. wakes = batches emitted (one bot wake each). Logged as one compact line.
export class Metrics {
  constructor() { this.reset(); }
  reset() { this.c = { seen: 0, woke: 0, filtered: {}, local: 0, batches: 0, retries: 0, bytes: 0, acked: 0, voiceCacheHits: 0, ttsSkipped: 0 }; this.lat = { queue: [], ack: [], reply: [] }; this.since = Date.now(); }
  inc(k, n = 1) { this.c[k] = (this.c[k] ?? 0) + n; }
  filtered(reason) { this.c.filtered[reason] = (this.c.filtered[reason] ?? 0) + 1; }
  time(k, ms) { if (!Number.isFinite(ms) || ms < 0) return; const a = this.lat[k]; a.push(ms); if (a.length > 200) a.shift(); }
  static pct(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
  snapshot() {
    const L = {}; for (const [k, a] of Object.entries(this.lat)) L[k] = { n: a.length, p50: Metrics.pct(a, 0.5), p95: Metrics.pct(a, 0.95) };
    const evPerWake = this.c.batches ? +(this.c.woke / this.c.batches).toFixed(2) : null;
    return { ...this.c, eventsPerWake: evPerWake, wakesAvoided: this.c.seen - this.c.batches, latencyMs: L, sinceMs: Date.now() - this.since };
  }
  line() { const s = this.snapshot(); return `seen=${s.seen} woke=${s.woke} wakes=${s.batches} local=${s.local} filtered=${JSON.stringify(s.filtered)} bytes=${s.bytes} ev/wake=${s.eventsPerWake} queue_p50=${s.latencyMs.queue.p50}ms ack_p50=${s.latencyMs.ack.p50}ms reply_p50=${s.latencyMs.reply.p50}ms`; }
}
