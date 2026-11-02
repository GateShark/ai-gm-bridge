// v0.8.0: context diff removed-only, morale + ship helpers against a fake pirateborg system (its outcome builders are stubbed).
import test from "node:test"; import assert from "node:assert/strict";
import { ContextCache } from "../scripts/lib/context.mjs";
import * as L from "../scripts/lib/ship.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";

test("context diff: removed journals only in removed, not changed", () => {
  const c = new ContextCache();
  c.diff({ scene: "S", "journal:A": "a", "journal:B": "b" }, { maxChars: 5000 });
  const d = c.diff({ scene: "S", "journal:A": "a2" }, { maxChars: 5000 });
  assert.deepEqual(d.changed, ["journal:A"]); assert.deepEqual(d.removed, ["journal:B"]);
  const e = c.diff({ scene: "S" }, { maxChars: 5000 });
  assert.deepEqual(e.changed, []); assert.deepEqual(e.removed, ["journal:A"]); assert.equal(e.unchanged, false);
});

test("pure ship helpers", () => {
  assert.equal(L.normAction("Broadside"), "broadsides"); assert.equal(L.normAction("small arms"), "smallArms"); assert.equal(L.normAction("x"), null);
  assert.deepEqual(L.applyDamage({ value: 10 }, 7, 3), { damage: 4, before: 10, after: 6, sinking: false });
  assert.deepEqual(L.applyDamage({ value: 3 }, 2, 5), { damage: 0, before: 3, after: 3, sinking: false });
  assert.equal(L.applyDamage({ value: 3 }, 9, 0).after, 0); assert.equal(L.applyDamage({ value: 3 }, 9, 0).sinking, true);
  assert.equal(L.moraleResult(7, 7), "stands"); assert.equal(L.moraleResult(8, 7, 3), "flees"); assert.equal(L.moraleResult(8, 7, 4), "surrenders");
  assert.equal(L.parseMorale("-"), null); assert.equal(L.parseMorale("8"), 8);
  const s = L.shipSummary({ id: "s", name: "Gull", type: "vehicle_npc", system: { attributes: { hp: { value: 0, max: 20 }, hull: { value: 2 } }, weapons: { broadsides: { die: "2d6", quantity: 2 } } } });
  assert.equal(s.armorDie, "1d4"); assert.equal(s.sinking, true); assert.equal(s.weapons.broadsides.die, "2d6"); assert.equal(s.weapons.ram.die, null);
  assert.equal(L.leanOutcome({ title: "Miss", roll: { total: 5 }, dr: 12, isSuccess: false }).success, false);
  L.markOwn(["o1"]); assert.equal(L.isOwn({ flags: { pirateborg: { outcomes: [{ id: "o1" }] } } }), true); assert.equal(L.isOwn({ flags: {} }), false);
});

test("local ! shortcuts", () => {
  assert.deepEqual(parseLocal("!morale Skeleton Crew"), { name: "moraleCheck", args: { actorName: "Skeleton Crew" } });
  assert.deepEqual(parseLocal("!morale Crew 8"), { name: "moraleCheck", args: { actorName: "Crew", morale: 8 } });
  assert.deepEqual(parseLocal("!ship Black Gull"), { name: "getShip", args: { actorName: "Black Gull" } });
  assert.deepEqual(parseLocal("!broadsides Black Gull dr 14"), { name: "shipAction", args: { actorName: "Black Gull", action: "broadsides", dr: 14 } });
  assert.deepEqual(parseLocal("!fullsail Gull"), { name: "shipAction", args: { actorName: "Gull", action: "fullSail" } });
  assert.equal(parseLocal("!hull Gull -1").args.resource, "hull"); assert.equal(parseLocal("!ram"), null);
});

// ---- fake Foundry + fake pirateborg system
const posted = [], cards = [], msgs = [];
let nextRoll = [];
class Roll { constructor(f) { this.formula = f; } async evaluate() { this.total = nextRoll.length ? nextRoll.shift() : 3; return this; } }
globalThis.Roll = Roll;
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async d => { msgs.push(d); return { id: "m" + msgs.length, ...d }; } };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } };
const ship = { id: "s1", name: "Black Gull", type: "vehicle", system: { attributes: { hp: { value: 12, max: 20 }, hull: { value: 1 }, shanties: { value: 1, max: 2 }, crew: { value: 5, max: 8 } },
  weapons: { broadsides: { die: "2d6", quantity: 1 }, ram: { die: "1d6" } }, crews: ["c1"], captain: "c1" },
  getActorArmorFormula() { return "1d2"; }, getScaledDamageFormula: (t, f) => f,
  async updateHp(v) { this.system.attributes.hp.value = v.value; }, async updateShanties(v) { this.system.attributes.shanties.value = v.value; } };
const enemy = { id: "s2", name: "Rival", type: "vehicle_npc", getActorArmorFormula: () => "1d4" };
const capt = { id: "c1", name: "Anne", type: "character", system: {} };
const crab = { id: "k1", name: "Crab", type: "creature", system: { attributes: { morale: 7 } } };
const actors = [ship, capt, crab, enemy];
const tok = { id: "t2", name: "Rival", actor: enemy };
globalThis.game = { system: { id: "pirateborg" }, i18n: { localize: k => k }, settings: { get: () => "" },
  actors: { get: id => actors.find(a => a.id === id) ?? null, getName: n => actors.find(a => a.name === n) ?? null } };
globalThis.canvas = { scene: { tokens: { get: id => id === "t2" ? { id: "t2", name: "Rival", object: tok } : null, find: f => [{ id: "t2", name: "Rival", object: tok }].find(f) ?? null } }, tokens: { get: () => tok } };
const calls = [];
let id = 0; const out = (o) => ({ id: "out" + (++id), ...o });
const fakeSys = {
  "outcome/creature/morale-outcome.js": { createMoraleOutcome: async ({ actor }) => { calls.push(["morale", actor.morale]); const t = nextRoll.shift() ?? 6;
    const s = t <= actor.morale; const sec = s ? undefined : { roll: { total: nextRoll.shift() ?? 2 } };
    return out({ roll: { total: t }, isStandingFirm: s, secondaryOutcome: sec, isFleeing: !s && sec.roll.total <= 3, isSurrendering: !s && sec.roll.total > 3 }); } },
  "outcome/ship/ship-broadsides-outcome.js": { createBroadsidesOutcome: async (o) => { calls.push(["broadsides", o]); return out({ title: "PB.Hit", roll: { total: 15 }, dr: o.dr, isSuccess: true, isCriticalSuccess: false, isFumble: false, damageFormula: "2d6" }); } },
  "outcome/ship/ship-ram-outcome.js": { createRamOutcome: async (o) => { calls.push(["ram", o]); return out({ type: "crew-attack" }); } },
  "outcome/actor/armor-outcome.js": { createArmorOutcome: async ({ formula }) => out({ formula, roll: { total: 2 } }) },
  "outcome/actor/inflict-damage-outcome.js": { createInflictDamageOutcome: async (o) => { calls.push(["inflict", o]); return out({ totalDamage: 4 }); } },
  "outcome/ship/ship-invoke-shanty-outcome.js": { createInvokeShantyOutcome: async () => out({ roll: { total: 13 }, dr: 12, isSuccess: true }) },
  "outcome/ship/ship-full-sail-outcome.js": { createFullSailOutcome: async (o) => { calls.push(["sail", o]); return out({ roll: { total: 9 }, dr: o.dr, isSuccess: false, isFumble: false, isCriticalSuccess: false }); } },
};
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async (p) => {
  if (p.endsWith("generic-card.js")) return { showGenericCard: async (o) => { cards.push(o); } };
  const k = p.replace(L.PB_API + "/", ""); if (!fakeSys[k]) throw new Error("no fake " + k); return fakeSys[k];
});
const { runCommand } = await import("../scripts/commands.mjs");
const run = (name, args) => runCommand({ name, args }, {});

test("moraleCheck reuses system createMoraleOutcome; creature morale or explicit; card marked own", async () => {
  nextRoll = [9, 5];
  const r = await run("moraleCheck", { actorName: "Crab" });
  assert.equal(r.ok, true); assert.equal(r.result.result, "surrenders"); assert.equal(r.result.morale, 7); assert.deepEqual(calls.at(-1), ["morale", 7]);
  assert.equal(L.isOwn({ flags: { pirateborg: { outcomes: cards.at(-1).outcomes } } }), true);
  nextRoll = [4]; const n = cards.length;
  const s = await run("moraleCheck", { morale: "8", toChat: false }); assert.equal(s.result.result, "stands"); assert.equal(cards.length, n);
  assert.equal((await run("moraleCheck", { actorName: "Anne" })).code, 400);
});

test("shipAction broadsides: no dialog, crew + dr + target armor from the system", async () => {
  const r = await run("shipAction", { actorName: "Black Gull", action: "broadside", crewActorName: "Anne", dr: 14, targetTokenName: "Rival" });
  assert.equal(r.ok, true, r.error); const [, o] = calls.at(-1);
  assert.equal(o.crew, capt); assert.equal(o.dr, 14); assert.equal(o.armorFormula, "1d4"); assert.equal(o.targetToken, tok);
  assert.equal(r.result.success, true); assert.equal(r.result.crit, false); assert.equal(r.result.damageFormula, "2d6"); assert.equal(r.result.target, "Rival");
  assert.equal(cards.at(-1).title, "PB.ShipCrewActionBroadsides");
});

test("shipAction ram mirrors shipRamAction; full sail fail keeps success:false; shanty spends a use", async () => {
  const r = await run("shipAction", { actorName: "Black Gull", action: "ram", targetTokenId: "t2", movement: 2 });
  assert.equal(r.ok, true); const inf = calls.find(c => c[0] === "inflict")[1]; assert.equal(inf.formula, "1d6 + 2"); assert.equal(inf.damageReduction, 0); // system default: armour ignored
  assert.equal(r.result.damage, 4); assert.equal(cards.at(-1).outcomes.length, 3);
  const f = await run("shipAction", { actorName: "Black Gull", action: "full sail", toChat: false }); assert.equal(f.result.success, false); assert.equal(calls.at(-1)[1].dr, 12);
  const s = await run("shipAction", { actorName: "Black Gull", action: "shanty" }); assert.equal(s.result.shantiesLeft, 0);
  assert.equal((await run("shipAction", { actorName: "Black Gull", action: "shanty" })).code, 409);
  assert.equal((await run("shipAction", { actorName: "Crab", action: "ram" })).code, 400);
  assert.equal((await run("shipAction", { actorName: "Black Gull", action: "fly" })).code, 400);
  assert.equal((await run("shipAction", { actorName: "Black Gull", action: "broadsides", targetTokenName: "Nope" })).code, 404);
});

test("shipDamage: hull die from the system, HP via updateHp, floor 0, local-flagged note; getShip", async () => {
  nextRoll = [1]; const r = await run("shipDamage", { actorName: "Black Gull", amount: 5 });
  assert.equal(r.ok, true); assert.equal(r.result.armorDie, "1d2"); assert.equal(r.result.damage, 4); assert.equal(ship.system.attributes.hp.value, 8);
  assert.equal(msgs.at(-1).flags["ai-gm-bridge"].local, true);
  nextRoll = [30]; const f = await run("shipDamage", { actorName: "Black Gull", formula: "5d6", armor: false, toChat: false });
  assert.equal(f.result.after, 0); assert.equal(f.result.sinking, true);
  assert.equal((await run("shipDamage", { actorName: "Black Gull" })).code, 400);
  const g = await run("getShip", { actorName: "Black Gull" });
  assert.equal(g.result.captain, "Anne"); assert.deepEqual(g.result.crewActors, ["Anne"]); assert.equal(g.result.sinking, true); assert.equal(g.result.armorDie, "1d2");
});

test("ship cards never wake the bot: main.mjs skips own outcome ids before roll matching", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  const i = src.indexOf("isOwnShipCard(msg)"), j = src.indexOf("F.onRollMessage(msg)"); assert.ok(i > 0 && i < j);
});

test("ramUsesArmor house rule subtracts the armour roll; default off matches the system", async () => {
  const g = game.settings.get; game.settings.get = (m, k) => k === "ramUsesArmor" ? true : "";
  try { calls.length = 0; const r = await run("shipAction", { actorName: "Black Gull", action: "ram", targetTokenId: "t2", movement: 1, toChat: false });
    assert.equal(r.ok, true); assert.equal(calls.find(c => c[0] === "inflict")[1].damageReduction, 2); }
  finally { game.settings.get = g; }
  calls.length = 0; await run("shipAction", { actorName: "Black Gull", action: "ram", targetTokenId: "t2", toChat: false });
  assert.equal(calls.find(c => c[0] === "inflict")[1].damageReduction, 0);
});
