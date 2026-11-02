// 0.8.3: immediate combat start/end events.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combatEvent, startedNow } from "../scripts/lib/combatevents.mjs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
const c = { id: "C1", scene: { id: "S1" }, round: 1, started: true, combatants: { contents: [{ name: "Hero" }, { actor: { name: "Bilge Rat" } }, {}] } };

test("combat start/end payload shape", () => {
  assert.deepEqual(combatEvent(c, "start"), { eventId: "combat:C1:start", type: "combat", state: "start", combatId: "C1", sceneId: "S1", round: 1, combatants: ["Hero", "Bilge Rat"] });
  const e = combatEvent({ ...c, scene: null, sceneId: "S2", round: 4, combatants: [{ name: "A" }] }, "end");
  assert.equal(e.state, "end"); assert.equal(e.sceneId, "S2"); assert.equal(e.round, 4); assert.deepEqual(e.combatants, ["A"]);
  assert.equal(combatEvent(c, "pause"), null); assert.equal(combatEvent(null, "start"), null);
});
test("startedNow: only when started and round becomes 1", () => {
  assert.equal(startedNow(c, { round: 1, turn: 0 }), true);
  assert.equal(startedNow(c, { turn: 2 }), false); assert.equal(startedNow(c, { round: 2 }), false);
  assert.equal(startedNow({ ...c, started: false }, { round: 1 }), false);
});
test("no duplicates: start eventId is claimed once per combat (combatStart + updateCombat)", () => {
  const d = new DedupeStore({ entries: [] }); const id = combatEvent(c, "start").eventId;
  assert.equal(d.claim(id, Date.now()), true); assert.equal(d.claim(id, Date.now()), false);
  assert.equal(d.claim(combatEvent(c, "end").eventId, Date.now()), true);
});
test("wiring: leader-only, urgent, setting default on, hooks", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /reg\("combatEvents", Boolean, true\)/); assert.match(m, /reg\("turnWake", Boolean, false\)/);
  assert.match(m, /if \(!enabled\(\) \|\| !amLeader\(\) \|\| !get\("combatEvents"\)\) return;/);
  assert.match(m, /emitEvent\(ev, \{ urgent: true \}\)/);
  assert.match(m, /Hooks\.on\("combatStart", \(c\) => combatState\(c, "start"\)\)/);
  assert.match(m, /startedNow\(c, change\)\) combatState\(c, "start"\)/);
  assert.match(m, /deleteCombat[^\n]*combatState\(c, "end"\)/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  assert.ok(en.AIGM.settings.combatEvents.name);
});
