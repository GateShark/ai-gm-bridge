import test from "node:test"; import assert from "node:assert/strict";
import { AudioQueue, isAutoplayBlocked, showAudioUnlockPrompt } from "../scripts/lib/audioqueue.mjs";
const nosleep = async () => {};
test("#10 collided clip is retried, not dropped", async () => {
  let n = 0; const q = new AudioQueue({ gapMs: 0, sleep: nosleep, play: async () => { if (n++ < 2) throw new Error("busy"); } });
  const r = await q.enqueue("a", {}); assert.equal(r.played, true); assert.equal(n, 3);
});
test("#10 gives up after retries and frees the id", async () => {
  const q = new AudioQueue({ gapMs: 0, retries: 1, sleep: nosleep, play: async () => { throw new Error("x"); } });
  const r = await q.enqueue("a", {}); assert.equal(r.played, false); assert.equal(q.seen.has("a"), false);
});
test("#11 blocked autoplay pauses, fires onBlocked once, unlock replays in order", async () => {
  let locked = true, blockedCalls = 0; const log = [];
  const q = new AudioQueue({ gapMs: 0, sleep: nosleep, onBlocked: () => blockedCalls++,
    play: async (c) => { if (locked) { const e = new Error("no"); e.name = "NotAllowedError"; throw e; } log.push(c.n); } });
  const p1 = q.enqueue("1", { n: 1 }), p2 = q.enqueue("2", { n: 2 });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(q.blocked, true); assert.equal(blockedCalls, 1); assert.equal(q.length, 2);
  locked = false; assert.equal(q.unlock(), true);
  assert.equal((await p1).played, true); assert.equal((await p2).played, true); assert.deepEqual(log, [1, 2]);
  assert.equal(q.unlock(), false);
});
test("isAutoplayBlocked detection", () => {
  assert.ok(isAutoplayBlocked({ name: "NotAllowedError" })); assert.ok(isAutoplayBlocked({ blocked: true }));
  assert.ok(!isAutoplayBlocked(new Error("404")));
});
test("#11 unlock prompt is one-time and click unlocks the queue", async () => {
  const els = {}; const body = { appendChild: (e) => { els[e.id] = e; } };
  const doc = { body, getElementById: (id) => els[id] ?? null, createElement: () => { const h = {}; return { style: {}, addEventListener: (t, f) => h[t] = f, remove() { delete els[this.id]; }, click: () => h.click() }; } };
  let unlocked = 0; const queue = { unlock: () => unlocked++ };
  const b = showAudioUnlockPrompt({ queue, doc }); assert.ok(b); assert.equal(showAudioUnlockPrompt({ queue, doc }), null);
  await b.click(); assert.equal(unlocked, 1); assert.equal(els["aigm-audio-unlock"], undefined);
});
