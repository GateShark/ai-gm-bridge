// 0.8.15: session save/recap, pets, one-step start/pause, quick GM buttons, ship tracking.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectSessionSnapshot, formatSessionRecap, applySessionHpPlan, MAX_SESSION_NOTES } from "../scripts/lib/session.mjs";
import { readPetFlag, petFlagData, listPetsFrom, neighborPosition, isAdjacent, planPetPlacement } from "../scripts/lib/pets.mjs";
import { turnInfo, turnText } from "../scripts/lib/turns.mjs";
import { listTables, planDamage, planLoot, isItemResult, summarizeDraw } from "../scripts/lib/quickgm.mjs";
import { collectShips, shipRosterFields, createCrewTracker, planShipFight } from "../scripts/lib/shiptrack.mjs";
import { combatRoster } from "../scripts/lib/combatevents.mjs";
import { Outbox, RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";
import { panelHtml } from "../scripts/lib/gmpanel.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";
import { groupFor, HIDDEN_KEYS } from "../scripts/lib/settingsui.mjs";
import { COMMANDS } from "../scripts/commands.mjs";
import {
  plainUser, publicPresence, presenceSnapshot, resolvePresenceSuspendSeconds,
  MAX_PRESENCE_SUSPEND_S, isPresenceSuspended, shouldProbeLink, presenceFreshOpts, isLinkFresh
} from "../scripts/lib/presence.mjs";
import { deriveGmStatus } from "../scripts/lib/gmstatus.mjs";

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

test("0.8.15 session snapshot is small and recap never includes GM notes", () => {
  const monkey = actor({ id: "m1", name: "Monkey", hp: 3, max: 3, pet: { ownerActorId: "a1", ownerName: "Tempus" }, type: "creature" });
  const tempus = actor({
    id: "a1", name: "Tempus", hp: 2, max: 10, pc: true,
    items: [
      { name: "Cutlass", type: "weapon" },
      { name: "Landlubber", type: "class" },
      { name: "Lucky Coin", type: "item" }
    ]
  });
  const snap = collectSessionSnapshot({
    scene: { id: "S1", name: "The Cove" },
    combat: { id: "C1", started: true, round: 2, turn: 0, combatant: { name: "Tempus" } },
    tokens: [
      { id: "t1", name: "Tempus", actor: tempus },
      { id: "t2", name: "Monkey", actor: monkey }
    ],
    notes: "The villain is actually the governor. " + "x".repeat(3000),
    now: savedAt,
    readHp: (a) => a.system.attributes.hp,
    readPet: readPetFlag
  });
  assert.equal(snap.scene.name, "The Cove");
  assert.equal(snap.combat.who, "Tempus");
  assert.equal(snap.actors[0].name, "Tempus");
  assert.deepEqual(snap.actors[0].items, ["Cutlass", "Lucky Coin"]);
  assert.ok(!snap.actors[0].items.includes("Landlubber"));
  assert.equal(snap.actors[1].pet.ownerName, "Tempus");
  assert.equal(snap.notes.length, MAX_SESSION_NOTES);
  assert.ok(snap.notes.startsWith("The villain is actually the governor."));
  const recap = formatSessionRecap(snap, { now });
  assert.match(recap, /Where we left off/);
  assert.match(recap, /The Cove/);
  assert.match(recap, /Tempus 2\/10 HP/);
  assert.match(recap, /Monkey 3\/3 HP/);
  assert.match(recap, /round 2/);
  assert.doesNotMatch(recap, /villain|governor|xxxx/);
  assert.deepEqual(applySessionHpPlan(snap), [
    { actorId: "a1", name: "Tempus", value: 2 },
    { actorId: "m1", name: "Monkey", value: 3 }
  ]);
  assert.equal(formatSessionRecap({ savedAt: 0 }), "No session snapshot saved yet.");
});

test("0.8.15 pet flag, list, and placement beside the owner", () => {
  assert.equal(readPetFlag({ flags: {} }), null);
  assert.deepEqual(petFlagData({ ownerActorId: "a1", ownerName: "Tempus" }), {
    ownerId: null, ownerName: "Tempus", ownerActorId: "a1", simpleAction: true
  });
  const pet = actor({ id: "m1", name: "Monkey", hp: 3, pet: { ownerActorId: "a1", ownerName: "Tempus" } });
  const owner = actor({ id: "a1", name: "Tempus", hp: 2, pc: true });
  assert.deepEqual(listPetsFrom([owner, pet]), [{ actorId: "m1", name: "Monkey", ownerId: null, ownerName: "Tempus", ownerActorId: "a1", simpleAction: true }]);
  const nextTo = neighborPosition({ x: 100, y: 200, w: 100, h: 100 }, 0, { grid: 100 });
  assert.deepEqual(nextTo, { x: 200, y: 200 });
  assert.equal(isAdjacent({ x: 200, y: 200 }, { x: 100, y: 200, w: 100 }, 100), true);
  assert.equal(isAdjacent({ x: 800, y: 800 }, { x: 100, y: 200, w: 100 }, 100), false);
  const tokens = [
    { id: "tt", name: "Tempus", actorId: "a1", actor: owner, x: 100, y: 200, w: 100, h: 100 },
    { id: "tm", name: "Monkey", actorId: "m1", actor: pet, x: 800, y: 800, w: 100, h: 100 }
  ];
  const moved = planPetPlacement({ pets: listPetsFrom([pet]), tokens, grid: 100 });
  assert.equal(moved[0].action, "move");
  assert.equal(moved[0].tokenId, "tm");
  assert.deepEqual({ x: moved[0].x, y: moved[0].y }, nextTo);
  const beside = planPetPlacement({
    pets: listPetsFrom([pet]),
    tokens: [{ ...tokens[0] }, { ...tokens[1], x: 200, y: 200 }],
    grid: 100
  });
  assert.equal(beside[0].action, "skip");
  assert.match(beside[0].reason, /already beside/);
  const missing = planPetPlacement({ pets: listPetsFrom([pet]), tokens: [tokens[0]].slice(0, 0), grid: 100 });
  assert.equal(missing[0].action, "skip");
  const create = planPetPlacement({ pets: listPetsFrom([pet]), tokens: [tokens[0]], grid: 100 });
  assert.equal(create[0].action, "create");
  assert.equal(create[0].actorId, "m1");
});

test("0.8.15 turn text reports the pet simple-action house rule without rewriting combat", () => {
  const users = [{ id: "u1", name: "Gate", isGM: false, active: true, character: { id: "a1" } }];
  const petActor = actor({ id: "m1", name: "Monkey", hp: 3, pet: { ownerActorId: "a1", ownerName: "Tempus", simpleAction: true } });
  const combat = {
    id: "C", started: true, round: 3, turn: 0,
    combatant: { name: "Monkey", isNPC: true, actor: petActor, players: [] },
    turns: [{ name: "Monkey" }, { name: "Tempus" }]
  };
  const t = turnInfo(combat, users);
  assert.equal(t.isPet, true);
  assert.equal(t.simpleAction, true);
  assert.equal(t.petOwner, "Tempus");
  assert.equal(turnText(t), "Round 3: Monkey is up — pet of Tempus, one simple action. Next: Tempus.");
  const normal = turnInfo({
    id: "C", started: true, round: 2, turn: 0,
    combatant: { name: "Bart", isNPC: false, actor: actor({ id: "b", name: "Bart", hp: 5, pc: true }), players: [users[0]] },
    turns: [{ name: "Bart" }, { name: "Shark" }]
  }, users);
  assert.equal(turnText(normal), "Round 2: Bart is up (Gate). Next: Shark.");
});

test("0.8.15 quick GM helpers: tables, damage clamp, loot split", () => {
  assert.deepEqual(listTables([{ id: "t1", name: "Cargo" }, { id: "t2", name: "Ahoy" }]).map(t => t.name), ["Ahoy", "Cargo"]);
  const dmg = planDamage([{ id: "a1", name: "Tempus", hp: { value: 2, max: 10 } }, { id: "a2", name: "Skeleton", hp: { value: 4, max: 4 } }], 3);
  assert.equal(dmg.amount, 3);
  assert.deepEqual(dmg.updates.map(u => [u.name, u.before, u.after]), [["Tempus", 2, 0], ["Skeleton", 4, 1]]);
  assert.equal(planDamage([], -5).amount, 5);
  assert.match(planDamage([], "nope").error, /number/);
  assert.equal(isItemResult({ type: "Item", documentId: "i1" }), true);
  assert.equal(isItemResult({ type: 2, documentUuid: "Item.abc" }), true);
  assert.equal(isItemResult({ text: "10 silver" }), false);
  const loot = planLoot([{ type: "Item", name: "Cutlass", documentId: "i1", documentUuid: "Item.i1" }, { text: "a rusty nail" }]);
  assert.deepEqual(loot.items, [{ name: "Cutlass", uuid: "Item.i1", id: "i1" }]);
  assert.deepEqual(loot.texts, ["a rusty nail"]);
  assert.deepEqual(summarizeDraw([{ text: "Cutlass" }, { name: "10s" }], "Cargo"), { table: "Cargo", text: "Cutlass; 10s" });
});

test("0.8.15 ship tracking reads official vehicle fields and does not invent system keys", () => {
  const ship = {
    id: "s1", name: "Black Gull", type: "vehicle",
    system: { attributes: { hp: { value: 12, max: 20 }, hull: { value: 1 }, crew: { value: 5, max: 8 } } }
  };
  const tokens = [{ id: "ts", name: "Black Gull", actor: ship, actorId: "s1" }];
  const listed = collectShips(tokens);
  assert.equal(listed[0].name, "Black Gull");
  assert.equal(listed[0].hp.value, 12);
  assert.equal(listed[0].crew.value, 5);
  assert.equal(listed[0].hull, 1);
  assert.deepEqual(shipRosterFields(ship), { kind: "ship", crew: 5, crewMax: 8, hull: 1 });
  assert.equal(shipRosterFields({ type: "character" }), null);
  const none = planShipFight({ tokens: [{ id: "t", name: "Tempus", actor: actor({ id: "a1", name: "Tempus", hp: 2 }) }] });
  assert.equal(none.error, "no ships on this scene");
  const fight = planShipFight({ tokens, selectedIds: ["ts"], combat: null });
  assert.deepEqual(fight.addTokenIds, ["ts"]);
  assert.equal(fight.startCombat, true);
  const tracker = createCrewTracker();
  tracker.sync({ id: "C", round: 1 });
  assert.equal(tracker.record("s1"), 1);
  assert.equal(tracker.record("s1"), 2);
  tracker.sync({ id: "C", round: 2 });
  assert.equal(tracker.count("s1"), 0);
  const roster = combatRoster({ combatants: [{ name: "Black Gull", actor: ship }] });
  assert.equal(roster[0].kind, "ship");
  assert.equal(roster[0].crew, 5);
  assert.equal(roster[0].hull, 1);
  const src = readFileSync(new URL("../scripts/lib/shiptrack.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /system\.\w+\s*=/);
  assert.doesNotMatch(src, /update\(\s*\{\s*"system\./);
});

test("0.8.15 outbox onlyTypes holds non-control events while paused", () => {
  const box = new Outbox();
  box.enqueue({ eventId: "chat:1", type: "chat", text: "hi" }, 1000);
  box.enqueue({ eventId: "ctrl:1", type: "control", action: "pause" }, 1000);
  const held = box.nextBatch(1000, "w", { onlyTypes: ["control"] });
  assert.equal(held.events.length, 1);
  assert.equal(held.events[0].type, "control");
  assert.equal(box.items.length, 2);
  const rest = box.nextBatch(20000, "w");
  assert.ok(rest.events.some(e => e.type === "chat"));
  assert.ok(RELAY_AUTO_ACK_TYPES.includes("shipCombat"));
  assert.ok(!RELAY_AUTO_ACK_TYPES.includes("control"));
});

test("0.8.15 panel, local commands, and wiring", () => {
  const html = panelHtml({
    tables: [{ id: "tb1", name: "Cargo" }],
    sessionNotes: "secret plot",
    sessionRecap: "Where we left off (Today 12:00:00): the crew is on The Cove."
  });
  for (const action of ["rollTable", "giveLoot", "applyDamage", "startShipCombat", "saveSession", "loadSession", "startGame", "pauseGame"]) {
    assert.match(html, new RegExp(`data-aigm-action="${action}"`));
  }
  assert.match(html, /data-aigm-table/);
  assert.match(html, /data-aigm-damage/);
  assert.match(html, /data-aigm-notes/);
  assert.match(html, /secret plot/);
  assert.match(html, /Where we left off/);
  assert.deepEqual(parseLocal("!save The governor is the villain"), { name: "saveSession", args: { notes: "The governor is the villain" } });
  assert.deepEqual(parseLocal("!load"), { name: "loadSession", args: {} });
  assert.deepEqual(parseLocal("!start"), { name: "start", args: {} });
  assert.deepEqual(parseLocal("!pause"), { name: "pause", args: {} });
  assert.equal(groupFor("sessionSnapshot"), "hidden");
  assert.ok(HIDDEN_KEYS.includes("sessionSnapshot"));
  assert.equal(groupFor("presenceSuspendUntil"), "hidden");
  assert.ok(HIDDEN_KEYS.includes("presenceSuspendUntil"));
  assert.ok(COMMANDS.debugSuspendPresence);
  for (const name of ["saveSession", "loadSession", "setPet", "listPets", "placePets", "start", "pause", "rollTable", "giveLoot", "applyDamage", "startShipCombat", "shipStatus"]) {
    assert.ok(COMMANDS[name], name);
  }
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /sessionSnapshot[\s\S]*savedAt: 0/);
  assert.match(main, /onlyTypes: \["control"\]/);
  assert.match(main, /type: "sessionControl"/);
  assert.match(main, /startGame: \(\) => doStart\(\)/);
  assert.match(main, /function doStart/);
  assert.match(main, /function doPause/);
  assert.match(main, /skipAiPauseEmit/);
  assert.match(main, /crewTracker\.sync/);
  assert.match(main, /type: "shipCombat"/);
  assert.match(main, /action === "startGame"/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /applyHp === true|a\.applyHp/);
  assert.match(cmds, /placePets === false/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.equal(en.panel.startGame, "Start game");
  assert.equal(en.panel.pauseGame, "Pause game");
  assert.equal(en.panel.saveSession, "Save session");
  assert.equal(en.panel.loadSession, "Where we left off");
  assert.equal(en.panel.startShipCombat, "Start ship fight");
});

test("0.8.15 version, changelog and docs", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.match(ver, /^0\.8\.1[56789]$/);
  assert.match(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, /^0\.8\.1[56789]$/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.15/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.1[56789]/);
  const api = readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8");
  assert.match(api, /saveSession/);
  assert.match(api, /shipCombat/);
  assert.match(api, /v0\.8\.15/);
});

test("0.8.15 status/turnStatus/ping payloads stringify without Foundry documents", () => {
  const user = { id: "bot1", name: "AI GM", active: true, isGM: true };
  user.targets = { user }; // circular, like a Foundry User doc
  assert.throws(() => JSON.stringify({ bot: user }));
  assert.deepEqual(plainUser(user), { id: "bot1", name: "AI GM", active: true });
  assert.equal(plainUser(null), null);
  const probe = { nonce: "abc", at: 900, by: "bot1", lastBotAt: 900 };
  const presence = publicPresence({ now: 1000, worldId: "pb-test", botUser: user, probe, botUserId: "bot1" });
  const status = {
    enabled: true,
    leader: { leaderId: "bot1", term: 1, lastBeat: 900, lastTermChange: 100, leaderIsBot: true },
    amLeader: true, queued: 0, dead: 0, deadIds: [],
    ...presence
  };
  const turnStatus = { active: false, expect: null, ...presence };
  const ping = { ok: true, result: presence };
  for (const [label, payload] of [["status", status], ["turnStatus", turnStatus], ["ping", ping]]) {
    const json = JSON.stringify(payload);
    assert.ok(json, label);
    assert.ok(json.length < 1500, `${label} too large: ${json.length}`);
    assert.ok(!json.includes("targets"), label);
    const parsed = JSON.parse(json);
    const bot = parsed.bot || parsed.result?.bot;
    assert.deepEqual(bot, { id: "bot1", name: "AI GM", active: true }, label);
  }
  const rawSnap = presenceSnapshot({ now: 1000, worldId: "pb-test", botUser: user, probe, botUserId: "bot1" });
  assert.equal("bot" in rawSnap, false);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /publicPresence\(/);
  assert.doesNotMatch(main, /return \{ \.\.\.snap, bot, botActive/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /publicPresence\(/);
});

test("0.8.15 debugSuspendPresence stops nonce refresh and can show the offline light", () => {
  assert.equal(resolvePresenceSuspendSeconds(90), 90);
  assert.equal(resolvePresenceSuspendSeconds(9999), MAX_PRESENCE_SUSPEND_S);
  assert.equal(resolvePresenceSuspendSeconds(0), 0);
  assert.equal(resolvePresenceSuspendSeconds(-5), 0);
  assert.equal(resolvePresenceSuspendSeconds("nope"), 0);
  assert.equal(isPresenceSuspended(20_000, 10_000), true);
  assert.equal(isPresenceSuspended(10_000, 20_000), false);
  assert.equal(isPresenceSuspended(0, 10_000), false);
  assert.equal(shouldProbeLink({ enabled: true, isBot: true, now: 10, nextProbeAt: 0, suspendUntil: 20 }), false);
  assert.equal(shouldProbeLink({ enabled: true, isBot: true, now: 30, nextProbeAt: 0, suspendUntil: 20 }), true);
  assert.equal(shouldProbeLink({ enabled: true, isBot: true, now: 30, nextProbeAt: 40, suspendUntil: 0 }), false);
  assert.equal(shouldProbeLink({ enabled: false, isBot: true, now: 30 }), false);
  assert.equal(shouldProbeLink({ enabled: true, isBot: false, now: 30 }), false);
  const now = 100_000;
  const stale = presenceFreshOpts({ botActive: true, lastSeen: 10_000, now, offlineAfterMs: 60_000, selfIsBot: false, suspendUntil: now + 30_000 });
  assert.equal(stale.botActive, false);
  assert.equal(stale.selfIsBot, true);
  assert.equal(isLinkFresh(stale), false);
  assert.equal(deriveGmStatus({ enabled: true, ...stale }), "offline");
  const recent = presenceFreshOpts({ botActive: true, lastSeen: 90_000, now, offlineAfterMs: 60_000, selfIsBot: false, suspendUntil: now + 30_000 });
  assert.equal(isLinkFresh(recent), true);
  assert.equal(deriveGmStatus({ enabled: true, ...recent }), "listening");
  const normal = presenceFreshOpts({ botActive: true, lastSeen: 10_000, now, offlineAfterMs: 60_000, selfIsBot: false, suspendUntil: 0 });
  assert.equal(isLinkFresh(normal), true);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /debugSuspendPresence/);
  assert.match(main, /shouldProbeLink/);
  assert.match(main, /presenceSuspendUntil/);
  assert.match(main, /presenceFreshOpts/);
  const cfg = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(cfg, /presenceSuspendUntil|debugSuspendPresence/);
});
