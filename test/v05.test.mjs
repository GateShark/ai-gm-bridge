import test from "node:test"; import assert from "node:assert/strict";
import { burstTest } from "../scripts/lib/bursttest.mjs"; import { Batcher } from "../scripts/lib/batcher.mjs";

// Deterministic fake clock that drives the harness to completion.
async function runFake(opts) {
  let now = 0, seq = 0; const timers = new Map();
  const p = burstTest({ ...opts, now: () => now, setT: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; }, clearT: id => timers.delete(id) });
  for (let guard = 0; timers.size && guard < 10000; guard++) {
    const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; timers.delete(id); now = t.at; t.f();
  }
  return p;
}
const SLACK = 50;

for (let seed = 1; seed <= 25; seed++) test(`jitter 1.1-2.3s (seed ${seed}): every event sent, max hold <= 4.0s + slack`, async () => {
  for (const ackAfterMs of [300, 2500, 9000]) {
    const r = await runFake({ count: 12, gapMs: [1100, 2300], seed, ackAfterMs, maxWaitMs: 4000 });
    assert.equal(r.batches.reduce((a, b) => a + b, 0), 12, JSON.stringify(r));
    assert.ok(r.maxHoldMs <= 4000 + SLACK, `hold ${r.maxHoldMs} (ack ${ackAfterMs}) ${JSON.stringify(r.batches)}`);
  }
});
test("9 at 800ms through the harness: 5+4, hold <= 4.0s", async () => {
  const r = await runFake({ count: 9, gapMs: 800, ackAfterMs: 5000, maxWaitMs: 4000 });
  assert.deepEqual(r.batches, [5, 4]); assert.ok(r.maxHoldMs <= 4000);
});
test("cap is measured from the earliest event (at), and fires synchronously once reached", () => {
  let now = 10_000, fired = 0, armed = null;
  const b = new Batcher({ debounceMs: 1200, maxWaitMs: 4000, now: () => now, setT: (f, ms) => (armed = ms), clearT: () => {}, onFlush: () => fired++ });
  b.push({ at: 7_000 }); assert.equal(armed, 1000); // 7000+4000-10000
  now = 11_500; b.push({ at: 11_500 }); assert.equal(fired, 1); // overdue: no 0 ms timer
  b.push({ at: 11_500 }); now = 16_000; b.check(); assert.equal(fired, 2); // throttled timer: heartbeat catch-up
});
