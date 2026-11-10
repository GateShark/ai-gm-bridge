// 0.8.11: NPC-only turnWake default, ready-made expect, clearer nextTurn errors, cancel rolls on combat end.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { turnInfo, combatExpect, combatantIsNpc, shouldWakeOnTurn, resolveTurnWake, readStoredFlag } from "../scripts/lib/turns.mjs";
import { checkExpect } from "../scripts/lib/result.mjs";
import { combatEvent } from "../scripts/lib/combatevents.mjs";
import * as F from "../scripts/features.mjs";

test("0.8.11 shouldWakeOnTurn is NPC/monster only and never fires for PCs", () => {
  const pc = { combatant: { name: "Tempus", actor: { hasPlayerOwner: true } } };
  const npc = { combatant: { name: "Skeleton", actor: { hasPlayerOwner: false } } };
  const bare = { combatant: { name: "Ghost" } };
  assert.equal(combatantIsNpc(pc.combatant), false);
  assert.equal(combatantIsNpc(npc.combatant), true);
  assert.equal(combatantIsNpc(bare.combatant), true);
  assert.equal(shouldWakeOnTurn(pc, true), false);
  assert.equal(shouldWakeOnTurn(npc, true), true);
  assert.equal(shouldWakeOnTurn(bare, true), true);
  assert.equal(shouldWakeOnTurn(npc, false), false);
  assert.equal(shouldWakeOnTurn(pc, false), false);
});

test("0.8.11 turnWake migration: unset becomes on; stored false is left off", () => {
  assert.equal(resolveTurnWake({ present: false }), true);
  assert.equal(resolveTurnWake({ present: true, value: true }), true);
  assert.equal(resolveTurnWake({ present: true, value: false }), false);
  const mem = new Map([["ai-gm-bridge.turnWake", false]]);
  assert.deepEqual(readStoredFlag({ get: (k) => mem.get(k) }, "ai-gm-bridge.turnWake"), { present: true, value: false });
  assert.deepEqual(readStoredFlag({ get: () => undefined }, "ai-gm-bridge.turnWake"), { present: false, value: undefined });
  assert.equal(resolveTurnWake(readStoredFlag({ get: () => undefined }, "k")), true);
});

test("0.8.11 turnStatus / turnInfo include a ready-made expect", () => {
  const users = [{ id: "p1", name: "Pat", isGM: false, active: true }];
  const owned = { hasPlayerOwner: true, testUserPermission: (u) => u.id === "p1" };
  const c = { id: "c1", started: true, round: 2, turn: 0, combatant: { name: "Bart", actor: owned }, turns: [{ name: "Bart" }, { name: "Shark" }] };
  const t = turnInfo(c, users);
  assert.deepEqual(t.expect, { combatId: "c1", round: 2, turn: 0 });
  assert.deepEqual(combatExpect(c), t.expect);
  assert.equal(combatExpect(null), null);
});

test("0.8.11 checkExpect names the current combatant and round", () => {
  const live = { combatId: "c", round: 2, turn: 1, combatant: "Skeleton" };
  assert.equal(checkExpect(live, { combatId: "c", round: 2, turn: 1 }), null);
  const missing = checkExpect(live, undefined);
  assert.equal(missing.code, 400);
  assert.match(missing.error, /expect \{combatId, round, turn\} required \(from turnStatus\)/);
  assert.match(missing.error, /round 2 turn 1/);
  assert.match(missing.error, /Skeleton is up/);
  const stale = checkExpect(live, { combatId: "c", round: 1, turn: 0 });
  assert.equal(stale.code, 409);
  assert.match(stale.error, /combat is now round 2 turn 1, Skeleton is up/);
  assert.match(stale.error, /pass expect from turnStatus/);
  assert.deepEqual(stale.live, { combatId: "c", round: 2, turn: 1, combatant: "Skeleton" });
  assert.match(checkExpect(null, null).error, /from turnStatus/);
});

globalThis.foundry = globalThis.foundry ?? { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), randomID: () => "rnd" } };
const combat = { id: "C1", started: true, round: 2, turn: 1, combatant: { name: "Skeleton", actor: { hasPlayerOwner: false } },
  turns: [{ name: "Skeleton" }], async nextTurn() { this.turn = 2; this.combatant = { name: "Tempus", actor: { hasPlayerOwner: true } }; } };
globalThis.game = {
  combat,
  combats: { get: (id) => id === "C1" ? combat : null },
  users: { contents: [], get: () => null, find: () => null },
  actors: { get: () => null, getName: () => null },
  settings: { get: () => undefined }
};
const { runCommand } = await import("../scripts/commands.mjs");

test("0.8.11 turnStatus command returns expect; nextTurn missing/stale expect explains the live combat", async () => {
  const status = await runCommand({ name: "turnStatus", args: {} }, {});
  assert.equal(status.ok, true);
  assert.equal(status.result.active, true);
  assert.deepEqual(status.result.expect, { combatId: "C1", round: 2, turn: 1 });
  assert.equal(status.result.name, "Skeleton");
  const missing = await runCommand({ name: "nextTurn", args: {} }, {});
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 400);
  assert.match(missing.error, /expect \{combatId, round, turn\}/);
  assert.match(missing.error, /round 2 turn 1/);
  assert.match(missing.error, /Skeleton/);
  const stale = await runCommand({ name: "nextTurn", args: { expect: { combatId: "C1", round: 1, turn: 0 } } }, {});
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 409);
  assert.match(stale.error, /round 2 turn 1/);
  assert.match(stale.error, /Skeleton/);
  const okTurn = await runCommand({ name: "nextTurn", args: { expect: status.result.expect } }, {});
  assert.equal(okTurn.ok, true, JSON.stringify(okTurn));
  assert.equal(okTurn.result.turn, 2);
  assert.deepEqual(okTurn.result.expect, { combatId: "C1", round: 2, turn: 2 });
});

test("0.8.11 ending a combat emits combat/end and cancels pending rolls tied to that combat", async () => {
  assert.equal(combatEvent({ id: "C1", round: 3, started: true, combatants: [{ name: "Tempus" }] }, "end").state, "end");
  const msgs = []; const emitted = [];
  const mkMsg = (d) => { const m = { id: "m" + (msgs.length + 1), ...d, async update(u) { if (u.content) m.content = u.content; const fl = Object.entries(u).find(([k]) => k.startsWith("flags.")); if (fl) m.flags["ai-gm-bridge"].rollRequest = fl[1]; } }; msgs.push(m); return m; };
  const defense = { id: "rr-def", userId: "p1", userName: "Pat", actorName: "Tempus", stat: "agility", dr: 12, status: "pending", at: 1, combatId: "C1" };
  const other = { id: "rr-other", userId: "p1", userName: "Pat", actorName: "Tempus", formula: "1d6", label: "Luck", status: "pending", at: 1, combatId: "C2" };
  const loose = { id: "rr-loose", userId: "p1", userName: "Pat", actorName: "Bart", stat: "strength", dr: 8, status: "pending", at: 1 };
  await mkMsg({ flags: { "ai-gm-bridge": { rollRequest: defense } }, content: "defend" });
  await mkMsg({ flags: { "ai-gm-bridge": { rollRequest: other } }, content: "other" });
  await mkMsg({ flags: { "ai-gm-bridge": { rollRequest: loose } }, content: "loose" });
  const priorGame = globalThis.game;
  globalThis.game = { ...priorGame, messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) } };
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: () => undefined, amLeader: () => true });
  assert.deepEqual(F.rollsTiedToCombat(F.pendingRequests(), "C1").map(r => r.id), ["rr-def"]);
  const cancelled = await F.cancelCombatRolls({ id: "C1" });
  assert.deepEqual(cancelled, ["rr-def"]);
  assert.equal(msgs[0].flags["ai-gm-bridge"].rollRequest.status, "cancelled");
  assert.equal(msgs[1].flags["ai-gm-bridge"].rollRequest.status, "pending");
  assert.equal(msgs[2].flags["ai-gm-bridge"].rollRequest.status, "pending");
  assert.equal(emitted[0].type, "rollCancelled");
  assert.equal(emitted[0].requestId, "rr-def");
  assert.ok(!F.pendingRequests().some(r => r.id === "rr-def"));
  globalThis.game = priorGame;
});

test("0.8.11 version, wiring and i18n", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.match(ver, /^0\.8\.\d+$/);
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, ver);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /reg\("turnWake", Boolean, true\)/);
  assert.match(main, /shouldWakeOnTurn\(c, get\("turnWake"\)/);
  assert.match(main, /cancelCombatRolls\(c\)/);
  assert.match(main, /deleteCombat[^\n]*combatState\(c, "end"\)/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /expect: "object\?"/);
  assert.match(cmds, /expect: t\?\.expect \?\? null/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.equal(en.settings.turnWake.name, "Wake on NPC/monster turns");
  assert.match(en.settings.turnWake.hint, /Player-character turns stay local/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.11/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), new RegExp(`v${ver.replaceAll(".", "\\.")}`));
  assert.match(readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8"), /v0\.8\.11/);
});
