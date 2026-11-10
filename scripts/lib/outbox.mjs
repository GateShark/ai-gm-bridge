// Pure outbound queue: events wait until acked; resend with backoff.
// batchId is derived from the exact event set (world + hash of sorted eventIds): the same id always means the same events,
// and a different set (e.g. after a partial ack) always gets a different id. Prevents a retry id carrying a different set.
export const BACKOFF_MS = [2000, 5000, 15000, 60000, 60000, 60000];
export const DEAD_TTL_MS = 6 * 3600 * 1000;
export function hashStr(s) { // cyrb53, sync, browser+node
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const batchIdFor = (world, eventIds) => `${world}:${hashStr([...eventIds].sort().join("|"))}`;
export class Outbox {
  constructor({ batchMax = 20, items = [], seq = 0 } = {}) { this.batchMax = batchMax; this.items = items; this.seq = seq; }
  enqueue(ev, now) {
    if (this.items.some(i => i.event.eventId === ev.eventId)) return false;
    this.items.push({ event: ev, attempts: 0, nextAt: now, firstAt: now, batchId: null }); return true;
  }
  isDead(i) { return i.attempts >= BACKOFF_MS.length + 1; }
  // retriesOnly: while a chat burst is still grouping, a retry wake must not pull its fresh events out early.
  nextBatch(now, world, { retriesOnly = false, onlyTypes = null } = {}) {
    const due = this.items.filter(i => i.nextAt <= now && !this.isDead(i) && (!retriesOnly || i.attempts > 0) && (!onlyTypes || onlyTypes.includes(i.event?.type))).slice(0, this.batchMax);
    if (!due.length) return null;
    const batchId = batchIdFor(world, due.map(i => i.event.eventId));
    const fresh = due.some(i => i.batchId !== batchId); if (fresh) this.seq++;
    for (const i of due) { i.batchId = batchId; i.nextAt = now + BACKOFF_MS[Math.min(i.attempts, BACKOFF_MS.length - 1)]; i.attempts++; }
    return { batchId, world, seq: this.seq, attempt: Math.max(...due.map(i => i.attempts)), events: due.map(i => i.event) };
  }
  nextDueAt() { const t = this.items.filter(i => !this.isDead(i) && i.attempts > 0).map(i => i.nextAt); return t.length ? Math.min(...t) : null; }
  ack(eventIds) { const s = new Set(eventIds); const before = this.items.length; this.items = this.items.filter(i => !s.has(i.event.eventId)); return before - this.items.length; }
  dead() { return this.items.filter(i => this.isDead(i)); }
  // Dead = retries exhausted with no ack (no relay listening). Drop after ttl so they don't linger across relaunches.
  purgeDead(now, ttl = DEAD_TTL_MS) { const before = this.items.length; this.items = this.items.filter(i => !(this.isDead(i) && now - (i.nextAt ?? 0) > ttl)); return before - this.items.length; }
  // Remove queued events matching pred (e.g. chat message deleted). Returns removed eventIds.
  dropWhere(pred) { const ids = this.items.filter(i => pred(i.event)).map(i => i.event.eventId); this.ack(ids); return ids; }
  clearDead() { const d = this.dead().map(i => i.event.eventId); this.ack(d); return d; }
  toJSON() { return { items: this.items, seq: this.seq }; }
}

// v0.8.10: in relay mode the module marks these types received after emit (Foundry chat
// and the matching socket/hook events). Control still waits for api.ack.
export const RELAY_AUTO_ACK_TYPES = ["chat", "combat", "turn", "rollResult", "rollTimeout", "rollCancelled", "pcDown", "shipCombat", "moralePrompt"];
export function relayAutoAckIds(events = []) {
  return (events ?? []).filter(e => e && RELAY_AUTO_ACK_TYPES.includes(e.type) && e.eventId).map(e => e.eventId);
}
export function relayStaleChatIds(items = []) {
  return (items ?? []).filter(i => i?.event && RELAY_AUTO_ACK_TYPES.includes(i.event.type) && i.event.eventId && (i.attempts > 0)).map(i => i.event.eventId);
}
