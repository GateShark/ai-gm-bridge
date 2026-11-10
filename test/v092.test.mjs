// 0.8.12: turnStatus uses the same PC/NPC helper as turn events (unlinked player tokens).
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { turnInfo, turnText, combatantIsNpc, combatantOwners, combatantActor, shouldWakeOnTurn } from "../scripts/lib/turns.mjs";

const gate = { id: "gate", name: "Gate" };
const users = [{ id: "gate", name: "Gate", isGM: false, active: true }, { id: "gm", name: "GM", isGM: true, active: true }];
const tempusUnlinked = {
  name: "Tempus",
  isNPC: false,
  actor: { type: "character", hasPlayerOwner: true, testUserPermission: () => false },
  token: { actor: { type: "character", hasPlayerOwner: true, testUserPermission: () => false } },
  players: [gate]
};

test("0.8.12 shared helper: unlinked player token is a PC, same as turn events", () => {
  assert.equal(combatantActor(tempusUnlinked), tempusUnlinked.actor);
  assert.equal(combatantIsNpc(tempusUnlinked, users), false);
  assert.equal(combatantIsNpc({ name: "Tempus", actor: { hasPlayerOwner: true, testUserPermission: () => false } }), false);
  assert.equal(combatantIsNpc({ name: "Tempus", actor: { type: "character", testUserPermission: () => false } }), false);
  assert.equal(combatantIsNpc({ name: "Tempus", isNPC: false, actor: { testUserPermission: () => false } }), false);
  assert.equal(combatantIsNpc({ name: "Skeleton", isNPC: true, actor: { hasPlayerOwner: false, type: "creature" } }), true);
  assert.equal(combatantIsNpc({ name: "Ghost" }), true);
  assert.deepEqual(combatantOwners(tempusUnlinked, users).map(u => u.name), ["Gate"]);
  assert.equal(shouldWakeOnTurn({ combatant: tempusUnlinked }, true, users), false);
  assert.equal(shouldWakeOnTurn({ combatant: { name: "Skeleton", isNPC: true, actor: { hasPlayerOwner: false } } }, true, users), true);
});

test("0.8.12 turnStatus does not label an unlinked player-owned Tempus as an NPC with no owner", () => {
  const combat = { id: "c1", started: true, round: 1, turn: 0, combatant: tempusUnlinked, turns: [tempusUnlinked, { name: "Skeleton 1" }] };
  const t = turnInfo(combat, users);
  assert.equal(t.name, "Tempus");
  assert.equal(t.isNPC, false);
  assert.deepEqual(t.ownerIds, ["gate"]);
  assert.deepEqual(t.ownerNames, ["Gate"]);
  assert.match(turnText(t), /Tempus is up \(Gate\)/);
  // Even if Foundry's players list is empty, hasPlayerOwner / isNPC / character type still win
  const noList = { ...tempusUnlinked, players: [] };
  const t2 = turnInfo({ ...combat, combatant: noList }, [{ id: "x", name: "X", isGM: false }]);
  assert.equal(t2.isNPC, false);
  assert.equal(combatantIsNpc({ name: "Tempus", isNPC: false, players: [], actor: { testUserPermission: () => false } }), false);
});

test("0.8.12 version and wiring share combatantIsNpc", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.equal(ver, "0.8.12");
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.12");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /shouldWakeOnTurn\(c, get\("turnWake"\), game\.users\?\.contents/);
  assert.match(main, /isNPC: combatantIsNpc\(c\.combatant, game\.users\?\.contents/);
  const turns = readFileSync(new URL("../scripts/lib/turns.mjs", import.meta.url), "utf8");
  assert.match(turns, /isNPC: combatantIsNpc\(cb, users\)/);
  assert.match(turns, /export function combatantOwners/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.12/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.12/);
});
