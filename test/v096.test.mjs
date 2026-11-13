// 0.8.16: recap PCs/pets only, Clear stuck drops control, prompt presence resume, unified targets.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectSessionSnapshot, formatSessionRecap, applySessionHpPlan,
  recapVisibleActors, prioritizeSessionActors, MAX_SESSION_ACTORS
} from "../scripts/lib/session.mjs";
import { readPetFlag } from "../scripts/lib/pets.mjs";
import { normalizeTargetArgs } from "../scripts/lib/quickgm.mjs";
import { Outbox } from "../scripts/lib/outbox.mjs";
import { COMMANDS } from "../scripts/commands.mjs";
import { validate } from "../scripts/lib/result.mjs";
import { shouldProbeLink, shouldForceResumeProbe, isPresenceSuspended } from "../scripts/lib/presence.mjs";

const now = Date.parse("2026-11-10T18:00:00-06:00");
const savedAt = Date.parse("2026-11-10T12:00:00-06:00");

function actor({ id, name, hp, max = 10, items = [], pet = null, pc = false, type = "character" }) {
  return {
    id, name, type, hasPlayerOwner: pc,
    items,
    flags: pet ? { "ai-gm-bridge": { pet } } : {},
    system: { attributes: { hp: { value: hp, max } } }
  };
}

test("0.8.16 session recap lists only player characters and pets", () => {
  const monkey = actor({ id: "m1", name: "Monkey", hp: 3, max: 3, pet: { ownerActorId: "a1", ownerName: "Tempus" }, type: "creature" });
  const tempus = actor({ id: "a1", name: "Tempus", hp: 2, max: 10, pc: true });
  const skeleton = actor({ id: "sk2", name: "Skeleton 2", hp: 0, max: 4, type: "creature" });
  const snap = collectSessionSnapshot({
    scene: { id: "S1", name: "The Cove" },
    combat: { id: "C1", started: true, round: 2, turn: 0, combatant: { name: "Tempus" } },
    tokens: [
      { id: "t3", name: "Skeleton 2", actor: skeleton },
      { id: "t1", name: "Tempus", actor: tempus },
      { id: "t2", name: "Monkey", actor: monkey }
    ],
    notes: "secret: the governor is the villain",
    now: savedAt,
    readHp: (a) => a.system.attributes.hp,
    readPet: readPetFlag
  });
  assert.ok(snap.actors.some(a => a.name === "Skeleton 2"));
  assert.ok(snap.actors.some(a => a.name === "Tempus" && a.pc));
  assert.ok(snap.actors.some(a => a.name === "Monkey" && a.pet));
  assert.deepEqual(recapVisibleActors(snap.actors).map(a => a.name), ["Tempus", "Monkey"]);
  const recap = formatSessionRecap(snap, { now });
  assert.match(recap, /Tempus 2\/10 HP/);
  assert.match(recap, /Monkey 3\/3 HP/);
  assert.doesNotMatch(recap, /Skeleton 2 0\/4/);
  assert.doesNotMatch(recap, /0\/4 HP/);
  assert.doesNotMatch(recap, /Skeleton/);
  assert.doesNotMatch(recap, /governor|villain/);
  assert.ok(applySessionHpPlan(snap).some(u => u.name === "Skeleton 2" && u.value === 0));

  const crowded = [];
  for (let i = 1; i <= 30; i++) {
    crowded.push({ id: `sk${i}`, name: `Skeleton ${i}`, actor: actor({ id: `s${i}`, name: `Skeleton ${i}`, hp: 0, max: 4, type: "creature" }) });
  }
  crowded.push({ id: "t1", name: "Tempus", actor: tempus });
  crowded.push({ id: "t2", name: "Monkey", actor: monkey });
  const full = collectSessionSnapshot({
    scene: { id: "S1", name: "The Cove" }, tokens: crowded, now: savedAt,
    readHp: (a) => a.system.attributes.hp, readPet: readPetFlag
  });
  assert.equal(full.actors.length, MAX_SESSION_ACTORS);
  assert.equal(full.actors[0].name, "Tempus");
  assert.equal(full.actors[1].name, "Monkey");
  const crowdedRecap = formatSessionRecap(full, { now });
  assert.match(crowdedRecap, /Tempus 2\/10 HP/);
  assert.match(crowdedRecap, /Monkey 3\/3 HP/);
  assert.doesNotMatch(crowdedRecap, /Skeleton/);
  assert.deepEqual(prioritizeSessionActors([
    { name: "Skeleton 1" }, { name: "Tempus", pc: true }, { name: "Monkey", pet: { ownerName: "Tempus" } }
  ], 2).map(a => a.name), ["Tempus", "Monkey"]);
});

test("0.8.16 Clear stuck acks held start/pause control events", () => {
  const box = new Outbox();
  box.enqueue({ eventId: "control:pause:1", type: "control", action: "pause" }, 1000);
  box.enqueue({ eventId: "control:start:2", type: "control", action: "start" }, 1000);
  box.enqueue({ eventId: "chat:1", type: "chat", text: "ahoy" }, 1000);
  assert.equal(box.items.length, 3);
  const ids = box.items.map(i => i.event.eventId);
  assert.ok(ids.includes("control:pause:1"));
  assert.ok(ids.includes("control:start:2"));
  const n = box.ack(ids);
  assert.equal(n, 3);
  assert.equal(box.items.length, 0);

  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /function clearLocalOutbox/);
  assert.match(main, /function doClearStuck/);
  assert.match(main, /clearLocalOutbox\(\)/);
  assert.match(main, /data\.type === "stuckCleared"/);
  assert.match(main, /if \(!amLeader\(\)\) clearLocalOutbox\(\)/);
  assert.match(main, /cleared: n, forwarded: true/);
  assert.match(main, /outboxState/);
  assert.match(main, /S\.outbox = new Outbox/);
});

test("0.8.16 presence resume after cancel or expiry ignores leftover nextProbeAt", () => {
  assert.equal(shouldForceResumeProbe({ suspended: true, wasSuspended: true }), false);
  assert.equal(shouldForceResumeProbe({ suspended: false, wasSuspended: true }), true);
  assert.equal(shouldForceResumeProbe({ suspended: false, wasSuspended: false }), false);
  assert.equal(shouldProbeLink({ enabled: true, isBot: true, now: 10_000, nextProbeAt: 40_000, suspendUntil: 0 }), false);
  assert.equal(shouldProbeLink({ enabled: true, isBot: true, now: 10_000, nextProbeAt: 0, suspendUntil: 0 }), true);
  assert.equal(isPresenceSuspended(40_000, 10_000), true);
  assert.equal(isPresenceSuspended(40_000, 40_000), false);

  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /function forceResumePresence/);
  assert.match(main, /function onPresenceSuspendSetting/);
  assert.match(main, /function armPresenceResumeTimer/);
  assert.match(main, /S\.nextProbeAt = 0/);
  assert.match(main, /shouldForceResumeProbe/);
  assert.match(main, /presenceResumeTimer = setTimeout/);
  assert.match(main, /armPresenceResumeTimer\(readSuspendUntil\(\)\)/);
  assert.equal((main.match(/setInterval/g) || []).length, 2);
});

test("0.8.16 giveLoot and applyDamage accept the same target argument shapes", () => {
  assert.deepEqual(normalizeTargetArgs({ tokenName: "Tempus" }), {
    tokenIds: [], tokenNames: ["Tempus"], actorIds: [], actorNames: [], sceneId: null, hasExplicit: true
  });
  assert.deepEqual(normalizeTargetArgs({ tokenIds: ["t1", "t1"] }), {
    tokenIds: ["t1"], tokenNames: [], actorIds: [], actorNames: [], sceneId: null, hasExplicit: true
  });
  assert.deepEqual(normalizeTargetArgs({ tokenId: "t1", tokenIds: ["t2"], actorName: "Tempus", sceneId: "S1" }), {
    tokenIds: ["t2", "t1"], tokenNames: [], actorIds: [], actorNames: ["Tempus"], sceneId: "S1", hasExplicit: true
  });
  assert.deepEqual(normalizeTargetArgs({ actorIds: ["a1"], actorId: "a2" }), {
    tokenIds: [], tokenNames: [], actorIds: ["a1", "a2"], actorNames: [], sceneId: null, hasExplicit: true
  });
  assert.equal(normalizeTargetArgs({}).hasExplicit, false);

  const shared = ["tokenId", "tokenName", "tokenIds", "actorId", "actorName", "actorIds", "sceneId"];
  for (const name of ["giveLoot", "applyDamage"]) {
    for (const k of shared) assert.ok(k in COMMANDS[name].schema, `${name}.${k}`);
  }
  assert.equal(validate(COMMANDS.giveLoot.schema, { tokenName: "Tempus" }), null);
  assert.equal(validate(COMMANDS.giveLoot.schema, { tokenIds: ["t1"] }), null);
  assert.equal(validate(COMMANDS.applyDamage.schema, { amount: 1, tokenIds: ["t1"] }), null);
  assert.equal(validate(COMMANDS.applyDamage.schema, { amount: 1, tokenName: "Tempus" }), null);
  assert.equal(validate(COMMANDS.applyDamage.schema, { amount: 1, tokenId: "t1", actorId: "a1" }), null);
  assert.equal(validate(COMMANDS.giveLoot.schema, { actorIds: ["a1"], tableName: "Cargo" }), null);

  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /normalizeTargetArgs/);
  assert.match(cmds, /const TARGET = /);
  const loot = cmds.slice(cmds.indexOf("giveLoot:"));
  assert.ok(loot.indexOf("if (!actor)") < loot.indexOf("table.draw"), "giveLoot should resolve the recipient before drawing");
});

test("0.8.16 version, changelog and docs", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.match(ver, /^0\.8\.(1[6-9]|2\d)$/);
  assert.match(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, /^0\.8\.(1[6-9]|2\d)$/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.16/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.16/);
  const api = readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8");
  assert.match(api, /v0\.8\.16/);
  assert.match(api, /tokenIds/);
  assert.match(api, /Clear stuck/);
});
