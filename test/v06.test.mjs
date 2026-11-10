import test from "node:test"; import assert from "node:assert/strict";
import { normStat, evaluate, canClick, cardHtml, matchRoll, naturalOf, formulaFor } from "../scripts/lib/rollreq.mjs";
import { turnInfo, turnText, voiceUsersFrom } from "../scripts/lib/turns.mjs";
import { actorChanges, lineHtml, parseLines, recap } from "../scripts/lib/sessionlog.mjs";
import { planRest, clampHp, diffReport } from "../scripts/lib/pbrest.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";
import { Batcher } from "../scripts/lib/batcher.mjs";
import { burstTest } from "../scripts/lib/bursttest.mjs";

// ---- burst target 3.5s ----
async function runFake(opts) {
  let now = 0, seq = 0; const timers = new Map();
  const p = burstTest({ ...opts, now: () => now, setT: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; }, clearT: id => timers.delete(id) });
  for (let g = 0; timers.size && g < 10000; g++) { const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; timers.delete(id); now = t.at; t.f(); }
  return p;
}
test("default cap is 3500 ms and stays configurable", () => {
  assert.equal(new Batcher({ onFlush() {} }).maxWaitMs, 3500);
  assert.equal(new Batcher({ maxWaitMs: 5000, onFlush() {} }).maxWaitMs, 5000);
});
for (let seed = 1; seed <= 15; seed++) test(`jitter 1.1-2.3s at default cap (seed ${seed}): all sent, hold <= 3.5s`, async () => {
  for (const ackAfterMs of [300, 2500, 9000]) {
    const r = await runFake({ count: 12, gapMs: [1100, 2300], seed, ackAfterMs });
    assert.equal(r.batches.reduce((a, b) => a + b, 0), 12); assert.ok(r.maxHoldMs <= 3550, `hold ${r.maxHoldMs}`);
  }
});
test("9 at 800ms at default cap: 5+4, hold <= 3.5s", async () => {
  const r = await runFake({ count: 9, gapMs: 800, ackAfterMs: 5000 }); assert.deepEqual(r.batches, [5, 4]); assert.ok(r.maxHoldMs <= 3500);
});

// ---- requestRoll (pure) ----
test("requestRoll: stats, evaluation, crit/fumble, click permission", () => {
  assert.equal(normStat("STR"), "strength"); assert.equal(normStat("Spirit"), "spirit"); assert.equal(normStat("luck"), null);
  assert.equal(formulaFor("agility"), "1d20 + @abilities.agility.value");
  assert.deepEqual(evaluate({ total: 12, natural: 10, dr: 12 }).success, true);
  assert.equal(evaluate({ total: 11, natural: 9, dr: 12 }).success, false);
  assert.equal(evaluate({ total: 18, natural: 20, dr: 25 }).success, true);
  assert.equal(evaluate({ total: 15, natural: 1, dr: 10 }).success, false);
  const req = { id: "r1", userId: "p1" };
  assert.ok(canClick(req, { id: "p1" })); assert.ok(canClick(req, { id: "gm", isGM: true })); assert.ok(!canClick(req, { id: "p2" })); assert.ok(!canClick(req, null));
});
test("requestRoll: card states and HTML escaping", () => {
  const base = { id: "r<1", stat: "agility", dr: 12, actorName: "Bart <b>", userName: "Pat", label: "" };
  assert.match(cardHtml({ ...base, status: "pending" }), /data-aigm-roll="r&lt;1">Roll Agility/); assert.ok(!cardHtml({ ...base, status: "pending" }).includes("<b>Bart"));
  assert.match(cardHtml({ ...base, status: "timeout" }), /data-gm-only="1"/);
  assert.match(cardHtml({ ...base, status: "done", result: { total: 14, success: true } }), /<b>14<\/b> → success/);
});
test("requestRoll: matches flagged button rolls, and Pixels/sheet d20 rolls by the requested user after the request", () => {
  const pending = [{ id: "a", userId: "p1", at: 100, status: "pending" }, { id: "b", userId: "p2", at: 100, status: "timeout" }];
  const d20 = [{ formula: "1d20 + 2", total: 14 }];
  assert.equal(matchRoll({ rolls: d20, flags: { "ai-gm-bridge": { rollRequestId: "b" } }, author: { id: "gm" } }, pending).id, "b");
  assert.equal(matchRoll({ rolls: d20, author: { id: "p1" }, timestamp: 150 }, pending).id, "a");
  assert.equal(matchRoll({ rolls: d20, author: { id: "p1" }, timestamp: 50 }, pending), null);     // before the request
  assert.equal(matchRoll({ rolls: [{ formula: "2d6" }], author: { id: "p1" }, timestamp: 150 }, pending), null);
  assert.equal(matchRoll({ rolls: d20, author: { id: "p3" }, timestamp: 150 }, pending), null);
  assert.equal(matchRoll({ rolls: [], author: { id: "p1" } }, pending), null);
  assert.equal(matchRoll({ rolls: d20, author: { id: "p1" }, timestamp: 150 }, [{ ...pending[0], status: "done" }]), null);
  assert.equal(naturalOf({ dice: [{ faces: 20, results: [{ result: 17, active: true }] }] }), 17);
});

// ---- turns ----
const users = [{ id: "gm", name: "GM", isGM: true }, { id: "p1", name: "Pat", active: true }, { id: "p2", name: "Lee", active: true }];
const actorOwnedBy = (ids) => ({ testUserPermission: (u) => ids.includes(u.id) });
test("turnInfo/turnText: who is up, owners, next; NPC; no combat", () => {
  const c = { id: "c1", started: true, round: 2, turn: 0, combatant: { name: "Bart", actor: actorOwnedBy(["p1"]) }, turns: [{ name: "Bart" }, { name: "Shark" }] };
  const t = turnInfo(c, users); assert.deepEqual([t.name, t.ownerIds, t.next, t.isNPC], ["Bart", ["p1"], "Shark", false]);
  assert.equal(turnText(t), "Round 2: Bart is up (Pat). Next: Shark.");
  const n = turnInfo({ ...c, turn: 1, combatant: { name: "Shark", actor: actorOwnedBy([]) } }, users); assert.ok(n.isNPC); assert.equal(n.next, "Bart");
  assert.equal(turnInfo({ started: false }, users), null); assert.equal(turnText(null), "No active combat.");
  assert.deepEqual(voiceUsersFrom(" Pat, LEE ,,"), ["pat", "lee"]);
});

// ---- session log ----
test("session log: HP damage/heal/death, resources, line round-trip, recap since", () => {
  const before = { system: { attributes: { hp: { value: 3 }, luck: { value: 2 }, rituals: { value: 1 }, extraResource: { value: 2 } } } };
  const after = { system: { attributes: { hp: { value: 0 }, luck: { value: 1 }, rituals: { value: 1 }, extraResource: { value: 3 } } } };
  const ch = actorChanges("Bart", before, after, { extraLabel: "Prayers" });
  assert.deepEqual(ch.map(c => c.kind), ["damage", "death", "spent", "gained"]);
  assert.equal(ch[0].text, "Bart HP 3→0 (-3)"); assert.match(ch[2].text, /Devil's Luck 2→1/); assert.match(ch[3].text, /Prayers 2→3/);
  assert.deepEqual(actorChanges("x", before, before), []);
  const html = lineHtml(1000, "item", "Bart gained <Cutlass> & rum") + lineHtml(5000, "damage", "Bart HP 3→2 (-1)") + lineHtml(9000, "combat", "Combat ended after round 3");
  const L = parseLines(html); assert.equal(L.length, 3); assert.equal(L[0].text, "Bart gained <Cutlass> & rum");
  const r = recap(L, { since: 4000 }); assert.equal(r.count, 2); assert.deepEqual(r.counts, { damage: 1, combat: 1 }); assert.equal(r.lines.length, 2);
  assert.equal(recap([]).summary, "nothing logged");
  assert.equal(recap(L, { since: new Date(4000).toISOString() }).count, 2);
});

// ---- PB rest ----
test("planRest follows pirateborg rest rules", () => {
  assert.deepEqual(planRest({ length: "short" }).steps.map(s => s.step), ["heal", "grogHours"]);
  assert.deepEqual(planRest({ length: "short", food: "donteat" }).steps.map(s => s.step), ["grogHours"]);
  assert.deepEqual(planRest({}).steps.map(s => s.step + (s.formula ?? "")), ["heald8", "rituals", "extraResource", "luckIfZero", "clearGrog"]);
  assert.deepEqual(planRest({ food: "starve", infected: true }).steps.map(s => s.why ?? s.step), ["starvation", "infection", "rituals", "extraResource", "luckIfZero", "clearGrog"]);
  assert.match(planRest({ length: "nap" }).error, /short or long/); assert.match(planRest({ food: "feast" }).error, /food/);
  assert.equal(clampHp(12, 8), 8); assert.equal(clampHp(-3, 8), 0);
  assert.equal(diffReport({ hp: 2, luck: 0 }, { hp: 7, luck: 3 }), "hp 2→7, luck 0→3"); assert.equal(diffReport({ a: 1 }, { a: 1 }), "no change");
});
test("local commands: !turn and !rest parsing", () => {
  assert.deepEqual(parseLocal("!turn"), { name: "turnStatus", args: {} });
  assert.deepEqual(parseLocal("!rest Bart"), { name: "rest", args: { actorName: "Bart", length: "long", food: "eat", infected: false } });
  assert.deepEqual(parseLocal("!rest Salty Pete short starve infected").args, { actorName: "Salty Pete", length: "short", food: "starve", infected: true });
  assert.equal(parseLocal("!rest"), null);
});

// ---- commands against a fake Foundry ----
const msgs = []; const emitted = []; const sock = []; const bubbles = []; let actorDoc;
const mkMsg = (d) => { const m = { id: "m" + (msgs.length + 1), timestamp: Date.now(), ...d, async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "content") m.content = v; else if (k.startsWith("flags.")) m.flags["ai-gm-bridge"].rollRequest = v; } } }; msgs.push(m); return m; };
const tok = { id: "t1", name: "Shark" }; const scene = { id: "s1", tokens: { get: id => id === "t1" ? tok : null, find: f => [tok].find(f) } };
actorDoc = { id: "a1", name: "Bart", type: "character", useExtraResource: true, extraResourceNamePlural: "Prayers", luckDie: "1d2",
  system: { attributes: { hp: { value: 2, max: 8 }, luck: { value: 0 }, rituals: { value: 0, max: 0 }, extraResource: { value: 0, max: 0 } }, abilities: { spirit: { value: 1 } } },
  getRollData() { return {}; }, async update(u) { for (const [k, v] of Object.entries(u)) k.split(".").slice(0, -1).reduce((o, s) => o[s], this)[k.split(".").at(-1)] = v; } };
const userP = { id: "p1", name: "Pat" };
globalThis.foundry = { utils: { randomID: () => "rnd123", getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), setProperty: () => {} } };
globalThis.ChatMessage = { async create(d) { return mkMsg(d); }, getSpeaker: () => ({}) };
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = 3; return this; } };
globalThis.canvas = { scene, tokens: { get: id => id === "t1" ? tok : null }, hud: { bubbles: { say: (t, text, o) => bubbles.push([t.id, text, o]) } } };
globalThis.game = { system: { id: "pirateborg" }, user: { id: "gm", isGM: true }, settings: { get: () => undefined },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP] },
  actors: { get: id => id === "a1" ? actorDoc : null, getName: n => n === "Bart" ? actorDoc : null }, scenes: { get: () => scene, active: scene },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) }, socket: { emit: (_n, d) => sock.push(d) }, combat: null };
const F = await import("../scripts/features.mjs"); const { runCommand } = await import("../scripts/commands.mjs");
F.initFeatures({ emit: (ev, o) => emitted.push([ev, o]), get: (k) => ({ rollRequestTimeoutMs: 600000 })[k], amLeader: () => true });

test("requestRoll command: card, idempotent requestId, result event once, bad stat", async () => {
  const r = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", stat: "agi", dr: 12, requestId: "q1" } }, {});
  assert.equal(r.ok, true); assert.equal(r.result.requestId, "q1"); assert.equal(msgs.length, 1);
  const again = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", stat: "agi", dr: 12, requestId: "q1" } }, {});
  assert.equal(again.result.duplicate, true); assert.equal(msgs.length, 1);
  const pixels = { rolls: [{ formula: "1d20 + 1", total: 13, dice: [{ faces: 20, results: [{ result: 12 }] }] }], author: userP, timestamp: Date.now() + 1, flags: {} };
  assert.equal(await F.onRollMessage({ ...pixels, author: { id: "p9" } }), false); // someone else's roll is ignored
  assert.equal(await F.onRollMessage(pixels), true);
  assert.equal(emitted.length, 1); const [ev, o] = emitted[0];
  assert.deepEqual([ev.type, ev.requestId, ev.total, ev.success, ev.dr, o.urgent], ["rollResult", "q1", 13, true, 12, true]);
  assert.match(msgs[0].content, /<b>13<\/b> → success/); assert.equal(await F.onRollMessage(pixels), false); // done: no second event
  const dup = await runCommand({ name: "requestRoll", args: { user: "Pat", stat: "agi", dr: 12, requestId: "q1" } }, {});
  assert.equal(dup.result.status, "done"); assert.equal(dup.result.result.total, 13);
  assert.equal((await runCommand({ name: "requestRoll", args: { user: "Pat", stat: "luck", dr: 12 } }, {})).code, "BAD_STAT");
  assert.equal((await runCommand({ name: "requestRoll", args: { user: "Nobody", stat: "str", dr: 12 } }, {})).code, "NOT_FOUND");
});
test("speakBubble: broadcasts once to other clients and shows locally; strips HTML", async () => {
  const r = await runCommand({ name: "speakBubble", args: { tokenName: "Shark", text: "<b>Arr</b> matey" } }, {});
  assert.equal(r.ok, true); assert.deepEqual(sock.at(-1), { type: "bubble", tokenId: "t1", text: "Arr matey", emote: false });
  assert.deepEqual(bubbles.at(-1).slice(0, 2), ["t1", "Arr matey"]);
  assert.equal((await runCommand({ name: "speakBubble", args: { tokenName: "Nope", text: "x" } }, {})).code, "NOT_FOUND");
  assert.equal((await runCommand({ name: "speakBubble", args: { tokenId: "t1", text: "<i></i>" } }, {})).code, "BAD_ARGS");
});
test("turnStatus with no combat; rest (fallback path, no system import in node) reports changes", async () => {
  const ts = (await runCommand({ name: "turnStatus", args: {} }, {})).result;
  assert.equal(ts.active, false);
  assert.equal(ts.expect, null);
  assert.ok("serverTime" in ts && "gmUserActive" in ts && "lastSeen" in ts && "worldId" in ts);
  const r = await runCommand({ name: "rest", args: { actorName: "Bart", length: "long" } }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.after.hp, 5); assert.equal(r.result.after.rituals, 0); assert.equal(r.result.after["Devil's Luck"], 3);
  assert.match(r.result.report, /hp 2→5/);
  assert.doesNotMatch(r.result.report, /rituals/);
  assert.equal((await runCommand({ name: "rest", args: { actorName: "Bart", length: "nap" } }, {})).code, "BAD_ARGS");
});
