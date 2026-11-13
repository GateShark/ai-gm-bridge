// 0.8.13: setupCheck, combat-start roster/owner warning, pcDown, relay auto-ack.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikePlayerPirate, hasNonGmOwner, runSetupCheck, liveSetupCheck, formatOwnerWarning, formatConnectionWithSetup, subjectFromToken } from "../scripts/lib/setupcheck.mjs";
import { combatEvent, combatRoster } from "../scripts/lib/combatevents.mjs";
import { createDownTracker, hpDroppedToZero, isPlayerOwnedActor } from "../scripts/lib/pcdown.mjs";
import { compactEvent } from "../scripts/lib/compact.mjs";
import { RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";
import { panelHtml } from "../scripts/lib/gmpanel.mjs";

const gate = { id: "gate", name: "Gate", isGM: false, active: true };
const users = [gate, { id: "gm", name: "GM", isGM: true, active: true }];
const tempusActor = { id: "ta", name: "Tempus", type: "character", hasPlayerOwner: true, system: { attributes: { hp: { value: 2, max: 10 } } }, testUserPermission: (u) => u.id === "gate" };
const unownedActor = { id: "ua", name: "Test Pirate", type: "character", hasPlayerOwner: false, system: { attributes: { hp: { value: 8, max: 8 } } }, testUserPermission: () => false };
const skeleton = { id: "sk", name: "Skeleton 1", type: "creature", hasPlayerOwner: false, system: { attributes: { hp: { value: 4, max: 4 } } } };

test("0.8.13 setupCheck warns about character-type pirates with no player owner", () => {
  assert.equal(looksLikePlayerPirate(tempusActor), true);
  assert.equal(looksLikePlayerPirate(unownedActor), true);
  assert.equal(looksLikePlayerPirate(skeleton), false);
  assert.equal(looksLikePlayerPirate({ type: "npc", items: [{ type: "class", name: "Landlubber" }] }), true);
  assert.equal(hasNonGmOwner({ actor: tempusActor, players: [gate] }, users), true);
  assert.equal(hasNonGmOwner({ actor: unownedActor }, users), false);
  const tokens = [
    { id: "tt", name: "Tempus", actor: tempusActor },
    { id: "tu", name: "Test Pirate", actor: unownedActor },
    { id: "ts", name: "Skeleton 1", actor: skeleton }
  ];
  const r = runSetupCheck({ tokens, users });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unowned.map(u => u.name), ["Test Pirate"]);
  assert.match(r.warning, /Test Pirate/);
  assert.match(r.warning, /no player owner/);
  assert.match(r.warning, /treated as a monster/);
  assert.match(r.warning, /Nothing was changed/);
  assert.ok(!r.warning.includes("Tempus"));
  assert.ok(!r.warning.includes("Skeleton"));
  const ok = runSetupCheck({ tokens: [{ id: "tt", name: "Tempus", actor: tempusActor }], users });
  assert.equal(ok.ok, true);
  assert.equal(ok.warning, null);
  assert.match(ok.text, /have a player owner/);
  assert.equal(formatOwnerWarning([]), null);
  const live = liveSetupCheck({ tokens, users, scene: { name: "Docks" } });
  assert.equal(live.scene, "Docks");
  assert.equal(formatConnectionWithSetup({ ok: true, message: "OK (HTTP 200)" }, r).includes("Test Pirate"), true);
  assert.match(formatConnectionWithSetup({ ok: false, error: "HTTP 503" }, ok), /HTTP 503 — All player-looking/);
  assert.deepEqual(subjectFromToken(tokens[0]).name, "Tempus");
  // helper is read-only
  assert.equal(unownedActor.hasPlayerOwner, false);
});

test("0.8.13 combat start includes compact roster and owner warning", () => {
  const combat = {
    id: "C2", scene: { id: "S" }, round: 1, started: true,
    combatants: [
      { name: "Tempus", isNPC: false, actor: tempusActor, players: [gate] },
      { name: "Test Pirate", isNPC: true, actor: unownedActor },
      { name: "Skeleton 1", isNPC: true, actor: skeleton }
    ]
  };
  const start = combatEvent(combat, "start", { users });
  assert.equal(start.state, "start");
  assert.deepEqual(start.combatants, ["Tempus", "Test Pirate", "Skeleton 1"]);
  assert.deepEqual(start.roster.find(r => r.name === "Tempus"), { name: "Tempus", isNPC: false, hp: 2, max: 10, owner: "Gate" });
  assert.equal(start.roster.find(r => r.name === "Skeleton 1").isNPC, true);
  assert.equal(start.roster.find(r => r.name === "Skeleton 1").owner, undefined);
  assert.equal(start.roster.find(r => r.name === "Skeleton 1").hp, 4);
  assert.match(start.ownerWarning, /Test Pirate/);
  assert.deepEqual(start.unownedPirates, ["Test Pirate"]);
  const packed = compactEvent(start);
  assert.equal(packed.roster.find(r => r.name === "Tempus").isNPC, false);
  assert.equal(packed.roster.find(r => r.name === "Tempus").hp, 2);
  assert.equal(packed.ownerWarning.includes("Test Pirate"), true);
  const end = combatEvent(combat, "end", { users });
  assert.equal(end.roster, undefined);
  assert.equal(end.ownerWarning, undefined);
  assert.deepEqual(combatRoster(combat, users).map(r => r.name), ["Tempus", "Test Pirate", "Skeleton 1"]);
});

test("0.8.13 pcDown fires once per drop for player characters and re-arms above 0", () => {
  assert.equal(hpDroppedToZero(5, 0), true);
  assert.equal(hpDroppedToZero(1, -1), true);
  assert.equal(hpDroppedToZero(0, 0), false);
  assert.equal(hpDroppedToZero(5, 3), false);
  assert.equal(isPlayerOwnedActor(tempusActor, users), true);
  assert.equal(isPlayerOwnedActor(unownedActor, users), false);
  assert.equal(isPlayerOwnedActor(skeleton, users), false);
  const tr = createDownTracker();
  const pc = { id: "ta", name: "Tempus", hasPlayerOwner: true, type: "character", token: { id: "tt" }, system: { attributes: { hp: { value: 5, max: 10 } } } };
  const combat = { id: "C2", round: 1, turn: 2, started: true };
  assert.equal(tr.observe(pc, { users, token: pc.token, combat }), null); // seed
  pc.system.attributes.hp.value = 0;
  const ev = tr.observe(pc, { users, token: pc.token, combat, now: 1000 });
  assert.equal(ev.type, "pcDown");
  assert.equal(ev.actor, "Tempus");
  assert.equal(ev.actorId, "ta");
  assert.equal(ev.tokenId, "tt");
  assert.deepEqual(ev.hp, { value: 0, max: 10 });
  assert.equal(ev.combatId, "C2");
  assert.equal(ev.round, 1);
  assert.equal(ev.turn, 2);
  assert.match(ev.eventId, /^pcdown:ta:/);
  assert.equal(tr.observe(pc, { users, token: pc.token, combat, now: 1001 }), null); // still down
  pc.system.attributes.hp.value = -1;
  assert.equal(tr.observe(pc, { users, token: pc.token, combat }), null); // deeper, same drop
  pc.system.attributes.hp.value = 3;
  assert.equal(tr.observe(pc, { users, token: pc.token, combat }), null); // re-arm
  pc.system.attributes.hp.value = 0;
  const ev2 = tr.observe(pc, { users, token: pc.token, combat, now: 2000 });
  assert.equal(ev2.type, "pcDown");
  assert.notEqual(ev2.eventId, ev.eventId);
  const packed = compactEvent(ev);
  assert.equal(packed.type, "pcDown");
  assert.equal(packed.hp.value, 0);
  assert.equal(packed.combatId, "C2");
  assert.equal(packed.turn, 2);
  // unowned pirate / monster never emit
  const npc = { id: "ua", name: "Test Pirate", type: "character", hasPlayerOwner: false, system: { attributes: { hp: { value: 8, max: 8 } } } };
  assert.equal(tr.observe(npc, { users }), null);
  npc.system.attributes.hp.value = 0;
  assert.equal(tr.observe(npc, { users }), null);
  const mon = { id: "sk", name: "Skeleton 1", type: "creature", hasPlayerOwner: false, system: { attributes: { hp: { value: 4, max: 4 } } } };
  assert.equal(tr.observe(mon, { users }), null);
  mon.system.attributes.hp.value = 0;
  assert.equal(tr.observe(mon, { users }), null);
  // already at 0 on first sight: no event
  const downAlready = { id: "z", name: "Zed", hasPlayerOwner: true, system: { attributes: { hp: { value: 0, max: 6 } } } };
  assert.equal(tr.observe(downAlready, { users }), null);
});

test("0.8.13 panel, local !setup, relay ack and wiring", () => {
  assert.deepEqual(parseLocal("!setup"), { name: "setupCheck", args: {} });
  assert.deepEqual(parseLocal("!setupcheck"), { name: "setupCheck", args: {} });
  assert.equal(parseLocal("!setup now"), null);
  const html = panelHtml({ setup: { warning: "Test Pirate looks like a player pirate but has no player owner and will be treated as a monster. Assign a non-GM owner before play. Nothing was changed." } });
  assert.match(html, /data-aigm-action="setupCheck"/);
  assert.match(html, /aigm-setup-warn/);
  assert.match(html, /Test Pirate/);
  assert.ok(!panelHtml({}).includes("aigm-setup-warn"));
  assert.ok(RELAY_AUTO_ACK_TYPES.includes("pcDown"));
  assert.ok(!RELAY_AUTO_ACK_TYPES.includes("control"));
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.match(ver, /^0\.8\.(1[3-9]|2\d)$/);
  assert.match(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, /^0\.8\.(1[3-9]|2\d)$/);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /combatEvent\(c, state, \{ users: game\.users\?\.contents/);
  assert.match(main, /setupCheck: \(\) => liveSetupCheck/);
  assert.match(main, /action === "setupCheck"/);
  assert.match(main, /cmd\.name === "setupCheck"/);
  const feat = readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8");
  assert.match(feat, /downs\.observe/);
  assert.match(feat, /D\.emit\(ev, \{ urgent: true \}\)/);
  assert.match(feat, /lastPrompt\.delete\(c\.id\)/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /setupCheck: \{ schema: \{\}/);
  const cfg = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.match(cfg, /formatConnectionWithSetup/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.13/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.1[3456789]/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.equal(en.panel.setupCheck, "Check setup");
});
