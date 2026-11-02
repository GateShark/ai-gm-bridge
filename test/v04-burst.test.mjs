// Repro of the v0.3.1 tuning bug: 9 messages 800 ms apart. After each flush the next batch must again group
// (1.2 s quiet, 4 s cap from its own first event); a retry wake for an in-flight batch must not split the burst.
import test from "node:test"; import assert from "node:assert/strict";
import { Batcher } from "../scripts/lib/batcher.mjs"; import { Outbox } from "../scripts/lib/outbox.mjs";

function sim({ ackAfterMs }) {
  let now = 0; let seq = 0; const timers = new Map();
  const setT = (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; };
  const clearT = (id) => timers.delete(id);
  const runUntil = (t) => { for (;;) { const due = [...timers].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].f(); } now = t; };
  const ob = new Outbox(); const sends = []; const seen = new Set();
  const b = new Batcher({ debounceMs: 1200, maxWaitMs: 4000, now: () => now, setT, clearT, onFlush: (o = {}) => {
    const batch = ob.nextBatch(now, "w", { retriesOnly: !!(o.retry && o.burstOpen) });
    if (batch) {
      const fresh = batch.events.filter(e => !seen.has(e.eventId)); fresh.forEach(e => seen.add(e.eventId));
      if (fresh.length) sends.push({ at: now, n: fresh.length });
      if (ackAfterMs != null) { const ids = batch.events.map(e => e.eventId); setT(() => ob.ack(ids), ackAfterMs); }
    }
    b.at(ob.nextDueAt());
  } });
  for (let i = 0; i < 9; i++) { runUntil(i * 800); ob.enqueue({ eventId: `chat:${i}` }, now); b.push(); }
  runUntil(60_000);
  return sends;
}

for (const [label, ackAfterMs] of [["acks after 300ms", 300], ["slow acks (5s, retry wake mid-burst)", 5000], ["no acks (retries)", null]]) {
  test(`9 messages 800ms apart group into batches of 3-5 (${label})`, () => {
    const s = sim({ ackAfterMs });
    assert.equal(s.reduce((a, x) => a + x.n, 0), 9, JSON.stringify(s));
    assert.ok(s.length <= 3, `too many calls: ${JSON.stringify(s)}`);
    for (const x of s) assert.ok(x.n >= 3 && x.n <= 5, `batch size ${x.n}: ${JSON.stringify(s)}`);
    assert.equal(s[0].at, 4000); // cap from first event
  });
}

test("burst after a flush gets a fresh cap measured from its own first event", () => {
  let now = 0; const fired = []; let t = null;
  const b = new Batcher({ debounceMs: 1200, maxWaitMs: 4000, now: () => now, setT: (f, ms) => (t = { f, at: now + ms }), clearT: () => { t = null; }, onFlush: () => fired.push(now) });
  b.push(); now = 1300; t.f(); assert.deepEqual(fired, [1300]); // quiet flush
  now = 10_000; b.push(); assert.equal(t.at, 11_200); // fresh 1.2 s debounce, not an old cap
});
