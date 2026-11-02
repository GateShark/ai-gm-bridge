import test from "node:test"; import assert from "node:assert/strict";
import { Outbox, batchIdFor, BACKOFF_MS } from "../scripts/lib/outbox.mjs";
import { Batcher } from "../scripts/lib/batcher.mjs";
import { classify } from "../scripts/lib/filter.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";
import { buildPayload, diff, trimText } from "../scripts/lib/compact.mjs";
import { VoiceCache, shouldSkipTts } from "../scripts/lib/voicecache.mjs";
import { Metrics } from "../scripts/lib/metrics.mjs";
import { waitForPosition } from "../scripts/lib/movewait.mjs";

const ev = (id) => ({ eventId: id, type: "chat", text: id });
test("batchId is a function of the event set: never reused for a different set (retry-reuse bug)", () => {
  const o = new Outbox(); o.enqueue(ev("a"), 0); o.enqueue(ev("b"), 0);
  const b1 = o.nextBatch(0, "test-world"); assert.equal(b1.batchId, batchIdFor("test-world", ["b", "a"]));
  const b2 = o.nextBatch(BACKOFF_MS[0], "test-world"); assert.equal(b2.batchId, b1.batchId); assert.equal(b2.attempt, 2); // same set → same id
  o.ack(["a"]); o.enqueue(ev("c"), 0);
  const b3 = o.nextBatch(10 ** 6, "test-world"); assert.notEqual(b3.batchId, b1.batchId);
  assert.deepEqual(b3.events.map(e => e.eventId).sort(), ["b", "c"]);
  o.ack(["c"]); const b4 = o.nextBatch(10 ** 7, "test-world"); // only b left: yet another id
  assert.ok(![b1.batchId, b3.batchId].includes(b4.batchId));
});
test("dead items: explained by exhausted retries, purged after ttl, clearDead works", () => {
  const o = new Outbox(); o.enqueue(ev("x"), 0); let t = 0;
  for (let i = 0; i < 10; i++) { o.nextBatch(t, "w"); t += 61000; }
  assert.equal(o.dead().length, 1); assert.equal(o.nextBatch(t, "w"), null); assert.equal(o.nextDueAt(), null);
  assert.equal(o.purgeDead(t, 10 ** 9), 0); assert.equal(o.purgeDead(t + 2 * 10 ** 9, 10 ** 9), 1);
  o.enqueue(ev("y"), 0); for (let i = 0; i < 10; i++) o.nextBatch(t + i * 10 ** 6, "w"); assert.deepEqual(o.clearDead(), ["y"]);
});
function fakeClock() { let now = 0; const timers = new Map(); let n = 0;
  return { now: () => now, setT: (f, ms) => { timers.set(++n, { f, at: now + ms }); return n; }, clearT: (id) => timers.delete(id),
    advance(ms) { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.f(); } } }; }
test("batcher: a burst becomes one flush; maxWait caps; urgent flushes at once", () => {
  const c = fakeClock(); let flushes = 0; const b = new Batcher({ debounceMs: 1000, maxWaitMs: 3000, onFlush: () => flushes++, ...c });
  for (let i = 0; i < 5; i++) { b.push(); c.advance(300); } assert.equal(flushes, 0); c.advance(1000); assert.equal(flushes, 1);
  for (let i = 0; i < 20; i++) { b.push(); c.advance(500); } assert.ok(flushes >= 2 && flushes <= 5, `flushes=${flushes}`);
  const before = flushes; b.push({ urgent: true }); assert.equal(flushes, before + 1);
  b.at(c.now() + 2000); c.advance(1999); assert.equal(flushes, before + 1); c.advance(1); assert.equal(flushes, before + 2);
});
test("filter is configurable and reports reasons", () => {
  const base = { botUserId: "bot" };
  assert.equal(classify({ text: "((brb))" }, base).reason, "ooc");
  assert.equal(classify({ text: "((brb))", inCharacter: true }, { ...base, ignoreOOC: false }).wake, true);
  assert.equal(classify({ text: "hi gm", authorId: "bot" }, base).reason, "bot");
  assert.equal(classify({ text: "", rolls: [{ total: 5 }] }, base).reason, "plainRoll");
  assert.equal(classify({ text: "", rolls: [{ total: 5 }] }, { ...base, ignorePlainRolls: false }).wake, true);
  assert.equal(classify({ text: "I sneak", inCharacter: true }, { ...base, wakeOn: ["mention", "question"] }).wake, false);
  assert.deepEqual(classify({ text: "@gm help" }, base), { wake: true, reason: "mention", urgent: true });
  assert.equal(classify({ text: "what?", author: "Dave" }, { ...base, ignoreUsers: ["dave"] }).reason, "ignoredUser");
});
test("local commands parse; non-commands return null", () => {
  assert.deepEqual(parseLocal("!roll 2d6+1"), { name: "roll", args: { formula: "2d6+1" } });
  assert.deepEqual(parseLocal("<p>!hp Bart Black -2</p>"), { name: "setResource", args: { actorName: "Bart Black", resource: "hp", delta: -2 } });
  assert.deepEqual(parseLocal("!luck Bart 3"), { name: "setResource", args: { actorName: "Bart", resource: "luck", value: 3 } });
  assert.deepEqual(parseLocal("!music Sea Shanties stop"), { name: "music", args: { playlist: "Sea Shanties", action: "stop" } });
  assert.deepEqual(parseLocal("!scene Port Royal"), { name: "scene", args: { sceneName: "Port Royal", activate: true } });
  assert.equal(parseLocal("!roll rm -rf"), null); assert.equal(parseLocal("hello !hp x 1"), null); assert.equal(parseLocal("!hp Bart"), null);
});
test("compact payload: html stripped, trimmed, empty fields dropped, ctx only as a diff", () => {
  assert.equal(trimText("<p>a&amp;b</p>" + "x".repeat(50), 10).length, 10);
  const ctx = { scene: "Port", combat: { round: 1, turn: 0 }, paused: false };
  const p1 = buildPayload({ batchId: "w:1", world: "w", seq: 1, attempt: 1, events: [{ eventId: "e", text: "<b>hi</b>", whisper: [], rolls: [], speaker: null, combat: { round: 1 } }] }, { ctx, prevCtx: null });
  assert.deepEqual(p1.events, [{ eventId: "e", text: "hi", rolls: [] }]); assert.deepEqual(p1.ctx, { scene: "Port", combat: { round: 1, turn: 0 }, paused: false }); // v0.7.2: false/0/[] kept
  const p2 = buildPayload({ batchId: "w:2", world: "w", seq: 2, attempt: 1, events: [] }, { ctx: { ...ctx, combat: { round: 1, turn: 1 } }, prevCtx: ctx });
  assert.deepEqual(p2.ctx, { combat: { round: 1, turn: 1 } });
  assert.equal(diff(ctx, ctx), null);
});
test("voice cache by normalized text; short replies skip TTS", () => {
  const v = new VoiceCache({ max: 2 }); v.put("Arr,  matey!", "a.mp3");
  assert.equal(v.get("arr, matey!"), "a.mp3"); assert.equal(v.get("other"), null);
  v.put("b", "b.mp3"); v.put("c", "c.mp3"); assert.equal(v.get("Arr, matey!"), null); // evicted (max 2)
  assert.equal(new VoiceCache({ entries: v.toJSON() }).get("c"), "c.mp3");
  assert.equal(shouldSkipTts("Aye.", 20), true); assert.equal(shouldSkipTts("Aye.", 0), false);
});
test("metrics count wakes avoided and latency percentiles", () => {
  const m = new Metrics(); for (let i = 0; i < 10; i++) m.inc("seen"); m.inc("woke", 4); m.inc("batches", 2); m.filtered("ooc"); m.time("queue", 1200); m.time("queue", 800);
  const s = m.snapshot(); assert.equal(s.wakesAvoided, 8); assert.equal(s.eventsPerWake, 2); assert.equal(s.latencyMs.queue.p50, 1200);
  assert.match(m.line(), /wakes=2/);
});
test("move waits for async v14 movement and reports the final position", async () => {
  const hooks = new Map(); let n = 0; const on = (h, f) => { hooks.set(++n, f); return n; }; const off = (h, id) => hooks.delete(id);
  const tok = { id: "t", x: 200, y: 200 };
  const p = waitForPosition(tok, 300, 300, { on, off, timeoutMs: 1000 });
  setTimeout(() => { tok.x = 300; tok.y = 300; for (const f of hooks.values()) f({ id: "t" }); }, 20);
  assert.deepEqual(await p, { reached: true, x: 300, y: 300 }); assert.equal(hooks.size, 0);
  const stuck = { id: "s", x: 0, y: 0 };
  assert.deepEqual(await waitForPosition(stuck, 5, 5, { on, off, timeoutMs: 30 }), { reached: false, x: 0, y: 0 });
});
