// Headless timing harness: feeds synthetic events to a fresh Batcher + Outbox with a mock sink (no ChatMessages,
// no socket, no bot wake). Same flush rules as main.mjs. Browser: game.modules.get("ai-gm-bridge").api.debug.burstTest({count: 9, gapMs: [1100, 2300]})
// Tests inject a fake clock/timers; the browser uses the real ones.
import { Batcher } from "./batcher.mjs"; import { Outbox } from "./outbox.mjs";
export function burstTest({ count = 9, gapMs = 800, debounceMs = 1200, maxWaitMs = 3500, ackAfterMs = 300, seed = 1,
  now = () => Date.now(), setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t) } = {}) {
  let r = seed >>> 0 || 1; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gap = () => Array.isArray(gapMs) ? gapMs[0] + rnd() * (gapMs[1] - gapMs[0]) : gapMs;
  const ob = new Outbox(); const batches = []; let pending = 0;
  return new Promise((resolve) => {
    const finish = () => { const holds = batches.flatMap(b => b.holds); resolve({ count, batches: batches.map(b => b.n), sentAtMs: batches.map(b => b.at - t0), maxHoldMs: Math.max(0, ...holds), holdsMs: holds }); };
    const b = new Batcher({ debounceMs, maxWaitMs, now, setT, clearT, onFlush: (o = {}) => {
      const t = now(); const batch = ob.nextBatch(t, "debug", { retriesOnly: !!(o.retry && o.burstOpen) });
      if (batch) {
        const fresh = ob.items.filter(i => i.batchId === batch.batchId && i.attempts === 1);
        if (fresh.length) batches.push({ n: fresh.length, at: t, holds: fresh.map(i => t - i.firstAt) });
        const ids = batch.events.map(e => e.eventId); pending++; setT(() => { ob.ack(ids); pending--; if (!ob.items.length && sent === count) finish(); }, ackAfterMs);
      }
      const left = ob.items.filter(i => i.attempts === 0); if (left.length) b.push({ at: Math.min(...left.map(i => i.firstAt)) });
      b.at(ob.nextDueAt());
    } });
    const t0 = now(); let sent = 0;
    const feed = () => { const t = now(); ob.enqueue({ eventId: `debug:${sent}`, type: "debug" }, t); sent++; b.push({ at: t }); if (sent < count) setT(feed, gap()); };
    feed();
  });
}
