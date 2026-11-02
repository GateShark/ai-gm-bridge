// v0.8.1: move displace fallback, v14 background, result formatting, burst grouping under debounce.
import test from "node:test"; import assert from "node:assert/strict";
import { moveWithFallback, setSceneBackground, formatResult } from "../scripts/lib/v081.mjs";
import { waitForPosition } from "../scripts/lib/movewait.mjs";
import { burstTest } from "../scripts/lib/bursttest.mjs";
import { Batcher } from "../scripts/lib/batcher.mjs";

const fakeHooks = () => { const m = new Map(); let n = 0; return { m, on: (h, f) => { m.set(++n, f); return n; }, off: (h, id) => m.delete(id) }; };

test("move: falls back to TokenDocument.move displace (ignoreWalls/ignoreCost) when update doesn't arrive", async () => {
  const H = fakeHooks(); const seen = [];
  const tok = { id: "t1", x: 0, y: 0, async update() { /* constrained: never arrives */ },
    async move(w, o) { seen.push([w, o]); setTimeout(() => { this.x = w.x; this.y = w.y; for (const f of H.m.values()) f(this); }, 5); } };
  const r = await moveWithFallback(tok, 100, 200, () => waitForPosition(tok, 100, 200, { on: H.on, off: H.off, timeoutMs: 30 }));
  assert.deepEqual(r, { reached: true, x: 100, y: 200, via: "displace" });
  assert.deepEqual(seen[0], [{ x: 100, y: 200, action: "displace" }, { constrainOptions: { ignoreWalls: true, ignoreCost: true } }]);
  assert.equal(H.m.size, 0);
});
test("move: no fallback when update arrives; still unreached (504 path) without TokenDocument.move", async () => {
  const H = fakeHooks(); let moved = 0;
  const ok = { id: "a", x: 0, y: 0, async update(u) { Object.assign(this, u); }, async move() { moved++; } };
  assert.equal((await moveWithFallback(ok, 5, 5, () => waitForPosition(ok, 5, 5, { on: H.on, off: H.off, timeoutMs: 30 }))).via, "update"); assert.equal(moved, 0);
  const stuck = { id: "b", x: 0, y: 0, async update() {} };
  const r = await moveWithFallback(stuck, 5, 5, () => waitForPosition(stuck, 5, 5, { on: H.on, off: H.off, timeoutMs: 20 }));
  assert.equal(r.reached, false);
});
test("setBackground: v14 writes the first level, older versions the scene", async () => {
  const up = []; const lvl = { id: "L1", background: {}, async update(u) { up.push(["level", u]); this.background.src = u["background.src"]; } };
  const s14 = { levels: { contents: [lvl] }, async update(u) { up.push(["scene", u]); } };
  assert.deepEqual(await setSceneBackground(s14, "maps/a.webp"), { via: "level", levelId: "L1", src: "maps/a.webp" });
  assert.deepEqual(up, [["level", { "background.src": "maps/a.webp" }]]);
  const old = { background: {}, async update(u) { this.background.src = u["background.src"]; } };
  assert.deepEqual(await setSceneBackground(old, "maps/b.webp"), { via: "scene", levelId: null, src: "maps/b.webp" });
});
test("formatResult: never raw JSON or [object Object]", () => {
  assert.equal(formatResult({ ok: true, result: { tokenId: "t", x: 1, y: 2 } }), "tokenId: t, x: 1, y: 2");
  assert.equal(formatResult({ ok: false, code: 404, error: "actor not found" }), "Error 404: actor not found");
  assert.equal(formatResult({ ok: true, result: { summary: "HP 30/30" } }), "HP 30/30");
  assert.equal(formatResult({ ok: true, result: null }), "OK");
  assert.ok(!formatResult({ ok: true, result: { a: { b: 1 } } }).includes("[object Object]"));
});

async function runFake(opts) {
  let now = 0, seq = 0; const timers = new Map();
  const p = burstTest({ ...opts, now: () => now, setT: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; }, clearT: id => timers.delete(id) });
  for (let g = 0; timers.size && g < 10000; g++) { const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; timers.delete(id); now = t.at; t.f(); }
  return p;
}
test("burst retest: events closer than debounceMs group into one batch", async () => {
  for (const gapMs of [100, 300, 800, 1100]) {
    const r = await runFake({ count: 3, gapMs, debounceMs: 1200, maxWaitMs: 3500 });
    assert.deepEqual(r.batches, [3], `gap ${gapMs}`); assert.ok(r.maxHoldMs <= 3500);
  }
  // gaps wider than debounce legitimately flush one at a time (what the headless smoke saw at ~2 s)
  const wide = (await runFake({ count: 3, gapMs: 2000, debounceMs: 1200, maxWaitMs: 3500 })).batches;
  assert.ok(wide.length >= 2 && wide[0] === 1 && wide.reduce((a, b) => a + b, 0) === 3, String(wide));
});
test("burst retest: Batcher alone fires once for a sub-debounce burst", () => {
  let now = 0, seq = 0; const timers = new Map(); let fires = 0;
  const b = new Batcher({ debounceMs: 1200, maxWaitMs: 3500, now: () => now, setT: (f, ms) => { timers.set(++seq, { at: now + ms, f }); return seq; }, clearT: id => timers.delete(id), onFlush: () => fires++ });
  for (const t of [0, 400, 800]) { now = t; b.push({ at: t }); }
  while (timers.size) { const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; timers.delete(id); now = t.at; t.f(); }
  assert.equal(fires, 1); assert.equal(now, 2000);
});
