import test from "node:test"; import assert from "node:assert/strict";
import { decideLeader, applyHeartbeat } from "../scripts/lib/leader.mjs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
import { Outbox } from "../scripts/lib/outbox.mjs";
import { KeyedMutex } from "../scripts/lib/mutex.mjs";
import { checkExpect, validate } from "../scripts/lib/result.mjs";
import { shouldWake } from "../scripts/lib/filter.mjs";
const T = 45000;

test("player never leads", () => assert.equal(decideLeader({ now: 0, selfId: "p", selfIsGM: false, selfIsBot: false, state: null, timeoutMs: T }).action, "passive"));
test("bot claims when nobody leads; human waits while bot fresh", () => {
  assert.equal(decideLeader({ now: 1000, selfId: "bot", selfIsBot: true, selfIsGM: true, state: null, timeoutMs: T }).action, "claim");
  const s = applyHeartbeat(null, { userId: "bot", isBot: true, term: 1 }, 1000);
  assert.equal(decideLeader({ now: 30000, selfId: "kev", selfIsBot: false, selfIsGM: true, state: s, timeoutMs: T }).action, "passive");
});
test("human takes over once after timeout, bot reclaims", () => {
  let s = applyHeartbeat(null, { userId: "bot", isBot: true, term: 1 }, 0);
  const d = decideLeader({ now: 100000, selfId: "kev", selfIsBot: false, selfIsGM: true, state: s, timeoutMs: T });
  assert.deepEqual(d, { action: "claim", term: 2 });
  s = applyHeartbeat(s, { userId: "kev", isBot: false, term: 2 }, 100000);
  assert.equal(decideLeader({ now: 101000, selfId: "kev", selfIsBot: false, selfIsGM: true, state: s, timeoutMs: T }).action, "lead");
  const b = decideLeader({ now: 102000, selfId: "bot", selfIsBot: true, selfIsGM: true, state: s, timeoutMs: T });
  assert.deepEqual(b, { action: "claim", term: 3 });
  s = applyHeartbeat(s, { userId: "bot", isBot: true, term: 3 }, 102000);
  assert.equal(s.leaderId, "bot");
  assert.equal(decideLeader({ now: 103000, selfId: "kev", selfIsBot: false, selfIsGM: true, state: s, timeoutMs: T }).action, "passive");
});
test("no second human takeover inside window", () => {
  const s = { leaderId: "kev2", term: 5, lastBeat: 0, lastTermChange: 40000, leaderIsBot: false };
  assert.equal(decideLeader({ now: 60000, selfId: "kev", selfIsBot: false, selfIsGM: true, state: s, timeoutMs: T }).action, "passive");
});
test("lower term heartbeat ignored; same-term tie prefers bot", () => {
  const s = applyHeartbeat(null, { userId: "kev", isBot: false, term: 4 }, 0);
  assert.equal(applyHeartbeat(s, { userId: "bot", isBot: true, term: 3 }, 1).leaderId, "kev");
  assert.equal(applyHeartbeat(s, { userId: "bot", isBot: true, term: 4 }, 1).leaderId, "bot");
});
test("dedupe: second claim blocked, failed claim retryable, expired claim retryable", () => {
  const d = new DedupeStore({ claimTtlMs: 90000 });
  assert.ok(d.claim("chat:a", 0)); assert.ok(!d.claim("chat:a", 1));
  d.release("chat:a", 2); assert.ok(d.claim("chat:a", 3));
  assert.ok(d.claim("chat:b", 0)); assert.ok(d.claim("chat:b", 100000));
  d.mark("chat:b", "acked", 5); assert.ok(!d.claim("chat:b", 999999));
});
test("dedupe ring bounded and survives JSON roundtrip", () => {
  const d = new DedupeStore({ max: 3 }); for (const i of [1, 2, 3, 4]) d.mark(`x${i}`, "acked", i);
  assert.ok(!d.has("x1")); const r = new DedupeStore({ entries: JSON.parse(JSON.stringify(d)) }); assert.ok(!r.claim("x4", 9));
});
test("outbox: dedupes eventId, keeps batchId on retry, ack removes", () => {
  const o = new Outbox(); assert.ok(o.enqueue({ eventId: "e1" }, 0)); assert.ok(!o.enqueue({ eventId: "e1" }, 0));
  const b1 = o.nextBatch(0, "w"); assert.equal(b1.events.length, 1);
  assert.equal(o.nextBatch(1000, "w"), null);
  const b2 = o.nextBatch(2000, "w"); assert.equal(b2.batchId, b1.batchId);
  assert.equal(o.ack(["e1"]), 1); assert.equal(o.nextBatch(999999, "w"), null);
});
test("checkExpect: match null, mismatch 409, missing 400", () => {
  const live = { combatId: "c", round: 2, turn: 1 };
  assert.equal(checkExpect(live, { ...live }), null);
  assert.equal(checkExpect(live, { combatId: "c", round: 2, turn: 0 }).code, 409);
  assert.equal(checkExpect(null, live).code, 409);
  assert.equal(checkExpect(live, { combatId: "c" }).code, 400);
});
test("mutex + expect: two concurrent nextTurns advance once", async () => {
  const m = new KeyedMutex(); const c = { combatId: "c", round: 1, turn: 0 }; const exp = { ...c };
  const adv = () => m.run("c", async () => { const s = checkExpect({ ...c }, exp); if (s) return s; await new Promise(r => setTimeout(r, 5)); c.turn++; return { ok: true }; });
  const [a, b] = await Promise.all([adv(), adv()]);
  assert.equal(c.turn, 1); assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
});
test("validate", () => {
  assert.equal(validate({ value: "number" }, { value: 3 }), null);
  assert.match(validate({ value: "number" }, {}), /required/);
  assert.equal(validate({ x: "string?" }, {}), null);
});
test("filter: OOC and plain rolls don't wake; mentions and questions do", () => {
  assert.ok(!shouldWake({ text: "((brb))" })); assert.ok(!shouldWake({ text: "", rolls: [{}] }));
  assert.ok(shouldWake({ text: "@GM can I climb the mast" })); assert.ok(shouldWake({ text: "does it hit?" }));
  assert.ok(!shouldWake({ text: "hi gm", authorId: "bot" }, { botUserId: "bot" }));
});
import { priorReply, recordReply, missedMessages } from "../scripts/lib/replies.mjs";
test("reply dedupe persists across reload/leader change", () => {
  const d = new DedupeStore(); assert.equal(priorReply(d, "m1"), null);
  recordReply(d, "m1", "r1", 1);
  const reloaded = new DedupeStore({ entries: JSON.parse(JSON.stringify(d)) });
  assert.equal(priorReply(reloaded, "m1"), "r1");
  assert.equal(priorReply(reloaded, "m1", true), null); // allowMultiple
  assert.equal(priorReply(reloaded, undefined), null);
});
test("post schema accepts allowMultiple boolean", () => {
  const schema = { content: "string", replyTo: "string?", speakerAlias: "string?", allowMultiple: "boolean?" };
  assert.equal(validate(schema, { content: "x", allowMultiple: true }), null);
  assert.match(validate(schema, { content: "x", allowMultiple: "yes" }), /boolean/);
});
test("repeated commandId: done vs in-progress", () => {
  const d = new DedupeStore(); assert.ok(d.claim("cmd:1", 0));
  assert.equal(d.get("cmd:1").s, "claimed"); assert.ok(!d.claim("cmd:1", 1));
  d.mark("cmd:1", "acked", 2, { res: { ok: true, result: 5 } });
  assert.ok(!d.claim("cmd:1", 3)); assert.deepEqual(d.get("cmd:1").res, { ok: true, result: 5 });
});
test("new leader catch-up: only recent, unseen messages, capped at N", () => {
  const d = new DedupeStore(); d.mark("chat:b", "sent", 0);
  const now = 1_000_000;
  const msgs = [{ id: "old", timestamp: now - 300000 }, { id: "b", timestamp: now - 1000 }, { id: "c", timestamp: now - 1000 }, { id: "d", timestamp: now }];
  assert.deepEqual(missedMessages(msgs, d, now).map(m => m.id), ["c", "d"]);
  assert.deepEqual(missedMessages(msgs, d, now, { maxN: 1 }).map(m => m.id), ["d"]);
});
