// 0.8.4 #15: requestRoll with any formula (1d6, 2d4+1, 1d20+@abilities.agility.value), d20 tests unchanged.
import test from "node:test"; import assert from "node:assert/strict";
import { evaluateFormula, cardHtml, matchRoll, reqFormula } from "../scripts/lib/rollreq.mjs";
const msgs = []; const emitted = []; const made = [];
const mkMsg = (d) => { const m = { id: "m" + (msgs.length + 1), timestamp: Date.now(), ...d, async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "content") m.content = v; else if (k.startsWith("flags.")) m.flags["ai-gm-bridge"].rollRequest = v; } } }; msgs.push(m); return m; };
const actorDoc = { id: "a1", name: "Bart", type: "character", getRollData() { return { abilities: { agility: { value: 1 } } }; } };
const userP = { id: "p1", name: "Pat" };
globalThis.foundry = { utils: { randomID: () => "rnd" + msgs.length, getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } };
globalThis.ChatMessage = { async create(d) { return mkMsg(d); }, getSpeaker: () => ({}) };
globalThis.Roll = class { static validate(f) { return !/bogus/.test(f); } constructor(f) { this.formula = f; made.push(f); } async evaluate() { this.total = 4; return this; } };
globalThis.game = { system: { id: "pirateborg" }, user: { id: "gm", isGM: true }, settings: { get: () => undefined },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP] },
  actors: { get: id => id === "a1" ? actorDoc : null, getName: n => n === "Bart" ? actorDoc : null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) }, socket: { emit() {} } };
const F = await import("../scripts/features.mjs"); const { runCommand } = await import("../scripts/commands.mjs");
F.initFeatures({ emit: (ev, o) => emitted.push([ev, o]), get: (k) => ({ rollRequestTimeoutMs: 600000 })[k], amLeader: () => true });

test("evaluateFormula: no DR -> total only; DR -> success; natural d20 keeps crit rules", () => {
  assert.deepEqual(evaluateFormula({ total: 3 }), { total: 3, natural: null, dr: null, success: null, crit: false, fumble: false });
  assert.equal(evaluateFormula({ total: 5, dr: 4 }).success, true); assert.equal(evaluateFormula({ total: 3, dr: 4 }).success, false);
  assert.equal(evaluateFormula({ total: 2, natural: 20, dr: 12 }).crit, true);
  assert.equal(reqFormula({ formula: "2d4+1", stat: null }), "2d4+1"); assert.equal(reqFormula({ stat: "agility" }), "1d20 + @abilities.agility.value");
});
test("card: label, button shows formula, no DR line when none, result without success word", () => {
  const req = { id: "x", formula: "1d6", label: "Broken", actorName: "Bart", userName: "Pat", status: "pending", dr: null };
  const h = cardHtml(req); assert.match(h, /<b>Broken<\/b><br>/); assert.match(h, /Roll 1d6<\/button>/); assert.doesNotMatch(h, /DR/);
  const d = cardHtml({ ...req, status: "done", result: { total: 4, success: null } }); assert.match(d, /<b>4<\/b><\/div>/); assert.doesNotMatch(d, /fail|success/);
});
test("requestRoll formula: card, button roll posts back as rollResult with formula + label", async () => {
  const r = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", formula: "1d6", label: "Broken", requestId: "b1" } }, {});
  assert.equal(r.ok, true, JSON.stringify(r)); const card = msgs.at(-1); const req = card.flags["ai-gm-bridge"].rollRequest;
  assert.equal(req.formula, "1d6"); assert.equal(req.stat, null); assert.equal(req.dr, null);
  const roll = { rolls: [{ formula: "1d6", total: 4, dice: [{ faces: 6, results: [{ result: 4 }] }] }], author: userP, timestamp: Date.now() + 1, flags: { "ai-gm-bridge": { rollRequestId: "b1" } } };
  assert.equal(await F.onRollMessage(roll), true);
  const [ev, o] = emitted.at(-1);
  assert.deepEqual([ev.type, ev.requestId, ev.formula, ev.label, ev.total, ev.success, ev.dr, o.urgent], ["rollResult", "b1", "1d6", "Broken", 4, null, null, true]);
  assert.match(card.content, /<b>4<\/b>/);
});
test("requestRoll formula with DR and abilities; validation errors; d20 stat test still needs dr", async () => {
  const r = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", formula: "1d20+@abilities.agility.value", dr: 12, label: "Dodge" } }, {});
  assert.equal(r.ok, true); assert.equal(msgs.at(-1).flags["ai-gm-bridge"].rollRequest.dr, 12);
  assert.equal((await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", formula: "bogus" } }, {})).code, "BAD_FORMULA");
  assert.equal((await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart" } }, {})).code, "BAD_STAT");
  assert.equal((await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", stat: "agi" } }, {})).code, "BAD_ARGS");
  const d20 = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", stat: "agi", dr: 12 } }, {});
  assert.equal(d20.ok, true); assert.equal(msgs.at(-1).flags["ai-gm-bridge"].rollRequest.formula, undefined);
});
test("unflagged d20 sheet rolls never answer a non-d20 formula request", () => {
  const now = Date.now();
  const p = [{ id: "f", formula: "1d6", stat: null, userId: "p1", actorId: "a1", at: now - 10, status: "pending" }];
  const m = { rolls: [{ formula: "1d20", total: 9 }], author: { id: "p1" }, timestamp: now, flags: {} };
  assert.equal(matchRoll(m, p, now), null);
  assert.equal(matchRoll(m, [{ ...p[0], formula: "1d20+1" }], now)?.id, "f");
});
test.after(() => setImmediate(() => process.exit(0))); // pending card timers (10 min) would keep node alive
