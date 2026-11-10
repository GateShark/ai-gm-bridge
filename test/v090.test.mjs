// 0.8.10: live Pirate Borg HP path, PC stance, scene-token resources, rest safety, Clear stuck, broader relay ack.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readActorHp, migratedHpPath, DEFAULT_HP_PATH, LEGACY_HP_PATH } from "../scripts/lib/hp.mjs";
import { tokenStance, buildSections, renderContext } from "../scripts/lib/context.mjs";
import { collectData } from "../scripts/context.mjs";
import { sceneTokenForActor } from "../scripts/lib/target.mjs";
import { planRest, canRestoreResource } from "../scripts/lib/pbrest.mjs";
import { panelHtml, formatStuckCount, formatClearedStuck, stuckCounts } from "../scripts/lib/gmpanel.mjs";
import { RELAY_AUTO_ACK_TYPES, relayAutoAckIds, relayStaleChatIds } from "../scripts/lib/outbox.mjs";
import * as F from "../scripts/features.mjs";

test("0.8.10 readActorHp prefers system.attributes.hp over a stale system.hp", () => {
  const actor = { system: { hp: { value: 0, max: 0 }, attributes: { hp: { value: 10, max: 10 } } } };
  assert.deepEqual(readActorHp(actor, LEGACY_HP_PATH), { value: 10, max: 10 });
  assert.deepEqual(readActorHp({ system: { hp: { value: 20, max: 20 } } }, LEGACY_HP_PATH), { value: 20, max: 20 });
  assert.deepEqual(readActorHp({ system: { attributes: { hp: { value: 0, max: 4 } } } }, DEFAULT_HP_PATH), { value: 0, max: 4 });
  assert.deepEqual(readActorHp({ system: { other: { hp: { value: 3, max: 5 } } } }, "system.other.hp.value"), { value: 3, max: 5 });
  assert.equal(readActorHp({}, DEFAULT_HP_PATH), null);
});

test("0.8.10 migratedHpPath upgrades only the stale default", () => {
  assert.equal(DEFAULT_HP_PATH, "system.attributes.hp.value");
  assert.equal(LEGACY_HP_PATH, "system.hp.value");
  assert.equal(migratedHpPath(LEGACY_HP_PATH), DEFAULT_HP_PATH);
  assert.equal(migratedHpPath(DEFAULT_HP_PATH), DEFAULT_HP_PATH);
  assert.equal(migratedHpPath("system.custom.hp.value"), "system.custom.hp.value");
});

test("0.8.10 tokenStance: player-owned or character tokens are PCs, never hostile", () => {
  assert.equal(tokenStance({ disposition: -1 }, { hasPlayerOwner: true, type: "character" }), "pc");
  assert.equal(tokenStance({ disposition: -1, hasPlayerOwner: true }, { type: "creature" }), "pc");
  assert.equal(tokenStance({ disposition: -1 }, { type: "character" }), "pc");
  assert.equal(tokenStance({ disposition: -1 }, { type: "creature" }), "hostile");
  assert.equal(tokenStance({ disposition: 1 }, { type: "creature" }), "friendly");
  assert.equal(tokenStance({ disposition: 0 }, {}), "neutral");
});

test("0.8.10 getContext collectData uses live HP and PC stance (Tempus/skeletons)", () => {
  const coll = (arr) => ({ contents: arr, get: (k) => arr.find(d => d.id === k), getName: (n) => arr.find(d => d.name === n), find: (f) => arr.find(f) });
  const scene = { id: "S1", name: "Deck", tokens: coll([
    { name: "Tempus", hidden: false, disposition: -1, hasPlayerOwner: true,
      actor: { type: "character", hasPlayerOwner: true, system: { hp: { value: 0 }, attributes: { hp: { value: 10, max: 10 } } } } },
    { name: "Skeleton", hidden: false, disposition: -1,
      actor: { type: "creature", system: { hp: { value: 0 }, attributes: { hp: { value: 4, max: 4 } } } } }
  ]) };
  const g = { user: { isGM: true }, scenes: { ...coll([scene]), active: scene },
    settings: { get: (_m, k) => k === "hpPath" ? LEGACY_HP_PATH : undefined } };
  const d = collectData(g);
  assert.deepEqual(d.tokens.find(t => t.name === "Tempus").hp, { value: 10, max: 10 });
  assert.equal(d.tokens.find(t => t.name === "Tempus").disposition, "pc");
  assert.deepEqual(d.tokens.find(t => t.name === "Skeleton").hp, { value: 4, max: 4 });
  assert.equal(d.tokens.find(t => t.name === "Skeleton").disposition, "hostile");
  const txt = renderContext(buildSections(d));
  assert.match(txt, /Tempus \(pc\) HP 10\/10/);
  assert.match(txt, /Skeleton \(hostile\) HP 4\/4/);
});

test("0.8.10 sceneTokenForActor matches by actor id or name", () => {
  const tokens = [
    { id: "t1", name: "Tempus", actorId: "A1", actor: { id: "A1", name: "Tempus" } },
    { id: "t2", name: "Skeleton", actorId: "S1", actor: { id: "S1", name: "Skeleton" } }
  ];
  assert.equal(sceneTokenForActor(tokens, { actorName: "Tempus" }).id, "t1");
  assert.equal(sceneTokenForActor({ find: (f) => tokens.find(f) }, { actorId: "A1" }).id, "t1");
  assert.equal(sceneTokenForActor({ contents: tokens }, { actor: { id: "S1", name: "Skeleton" } }).id, "t2");
  assert.equal(sceneTokenForActor(tokens, { actorName: "Nope" }), null);
  assert.equal(sceneTokenForActor(null, { actorName: "Tempus" }), null);
});

test("0.8.10 planRest accepts kind as an alias and rejects unknown types", () => {
  assert.deepEqual(planRest({}).steps.map(s => s.step), ["heal", "rituals", "extraResource", "luckIfZero", "clearGrog"]);
  assert.equal(planRest({ kind: "short" }).length, "short");
  assert.equal(planRest({ kind: "LONG" }).length, "long");
  assert.equal(planRest({ length: "short", kind: "long" }).length, "short");
  assert.match(planRest({ kind: "nap" }).error, /short or long/);
  assert.match(planRest({ length: "medium" }).error, /short or long/);
  assert.match(planRest({ kind: "shortish" }).error, /short or long/);
});

test("0.8.10 canRestoreResource requires a real pool (max > 0)", () => {
  const none = { system: { attributes: { rituals: { value: 0, max: 0 }, extraResource: { value: 0, max: 0 } } }, useExtraResource: true };
  const has = { system: { attributes: { rituals: { value: 0, max: 2 }, extraResource: { value: 1, max: 3 } } }, useExtraResource: true };
  assert.equal(canRestoreResource(none, "rituals"), false);
  assert.equal(canRestoreResource(has, "rituals"), true);
  assert.equal(canRestoreResource(none, "extraResource"), false);
  assert.equal(canRestoreResource(has, "extraResource"), true);
  assert.equal(canRestoreResource({ useExtraResource: false, system: { attributes: { extraResource: { max: 3 } } } }, "extraResource"), false);
  assert.equal(canRestoreResource({}, "rituals"), false);
});

const applyUpdate = (actor, u) => {
  for (const [k, v] of Object.entries(u)) {
    const ks = k.split("."); let o = actor; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)] = v;
  }
};
const mkChar = (name, hp, extras = {}) => ({
  id: name.toLowerCase(), name, type: "character", useExtraResource: !!extras.useExtraResource,
  luckDie: extras.luckDie ?? null,
  extraResourceFormula: extras.extraResourceFormula,
  extraResourceNamePlural: extras.extraResourceNamePlural,
  system: { attributes: {
    hp: { value: hp, max: extras.hpMax ?? 10 },
    luck: { value: extras.luck ?? 1 },
    rituals: extras.rituals ?? { value: 0, max: 0 },
    extraResource: extras.extraResource ?? { value: 0, max: 0 }
  }, abilities: { spirit: { value: 1 } } },
  getRollData() { return {}; },
  updates: [],
  async update(u) { this.updates.push(u); applyUpdate(this, u); }
});

globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), getRoute: () => { throw new Error("no system"); } } };
globalThis.ChatMessage = { async create() { return { id: "m1" }; }, getSpeaker: () => ({}) };
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = 3; return this; } };
const baseTempus = mkChar("Tempus", 10);
const tokenTempus = mkChar("Tempus", 2);
const offstage = mkChar("Offstage", 8, { rituals: { value: 0, max: 2 } });
const unlinked = { id: "tok-t", name: "Tempus", actorLink: false, actor: tokenTempus, actorId: "tempus" };
const scene = { id: "S", tokens: { get: (id) => id === unlinked.id ? unlinked : null, find: (f) => [unlinked].find(f) } };
globalThis.canvas = { scene };
globalThis.game = {
  system: { id: "pirateborg" },
  settings: { get: () => DEFAULT_HP_PATH },
  actors: { get: (id) => ({ tempus: baseTempus, offstage })[id] ?? null, getName: (n) => n === "Tempus" ? baseTempus : n === "Offstage" ? offstage : null },
  scenes: { get: () => scene, active: scene, viewed: scene }
};
const { runCommand } = await import("../scripts/commands.mjs");

test("0.8.10 getResources by actorName uses the scene token actor, not the base sheet", async () => {
  const r = await runCommand({ name: "getResources", args: { actorName: "Tempus" } }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.resources.hp.value, 2);
  assert.equal(r.result.via, "token");
  assert.equal(r.result.tokenId, "tok-t");
  const off = await runCommand({ name: "getResources", args: { actorName: "Offstage" } }, {});
  assert.equal(off.ok, true);
  assert.equal(off.result.resources.hp.value, 8);
  assert.equal(off.result.tokenId, undefined);
});

test("0.8.10 rest skips rituals when max is 0 and rejects unknown kind via the command", async () => {
  const noRituals = mkChar("Sailor", 2, { rituals: { value: 0, max: 0 }, luck: 1 });
  const r = await F.rest(noRituals, { length: "long" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(noRituals.system.attributes.rituals.value, 0);
  assert.equal(noRituals.system.attributes.rituals.max, 0);
  assert.doesNotMatch(r.result.report, /rituals/);
  const hasRituals = mkChar("Witch", 2, { rituals: { value: 0, max: 2 }, luck: 1 });
  const r2 = await F.rest(hasRituals, { kind: "long" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(hasRituals.system.attributes.rituals.value, 3);
  const bad = await runCommand({ name: "rest", args: { actorName: "Offstage", kind: "nap" } }, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "BAD_ARGS");
  assert.match(bad.error, /short or long/);
});

test("0.8.10 panel Clear stuck UI and count helpers", () => {
  assert.deepEqual(stuckCounts({ queued: 4, dead: 4 }), { queued: 4, dead: 4, total: 8 });
  assert.match(formatStuckCount({ queued: 4, dead: 4 }), /8 stuck \(4 queued, 4 dead\)/);
  assert.equal(formatStuckCount({}), "No stuck events.");
  assert.equal(formatClearedStuck(8), "Cleared 8 stuck event(s).");
  const html = panelHtml({ stuck: { queued: 4, dead: 4 } });
  assert.match(html, /data-aigm-action="clearStuck"/);
  assert.match(html, /8 stuck \(4 queued, 4 dead\)/);
  assert.doesNotMatch(html, /clearStuck" disabled/);
  const empty = panelHtml({});
  assert.match(empty, /data-aigm-action="clearStuck" disabled/);
  assert.match(empty, /No stuck events/);
});

test("0.8.10 relay auto-ack covers combat, turns and roll-request outcomes, not control", () => {
  assert.deepEqual(RELAY_AUTO_ACK_TYPES, ["chat", "combat", "turn", "rollResult", "rollTimeout", "rollCancelled"]);
  assert.deepEqual(relayAutoAckIds([
    { eventId: "chat:a", type: "chat" },
    { eventId: "combat:x:start", type: "combat" },
    { eventId: "rollreq:1", type: "rollResult" },
    { eventId: "rollreq:1:timeout", type: "rollTimeout" },
    { eventId: "rollreq:1:cancel", type: "rollCancelled" },
    { eventId: "control:pause:1", type: "control" }
  ]), ["chat:a", "combat:x:start", "rollreq:1", "rollreq:1:timeout", "rollreq:1:cancel"]);
  assert.deepEqual(relayStaleChatIds([
    { event: { eventId: "combat:old", type: "combat" }, attempts: 2 },
    { event: { eventId: "control:x", type: "control" }, attempts: 3 },
    { event: { eventId: "chat:fresh", type: "chat" }, attempts: 0 }
  ]), ["combat:old"]);
});

test("0.8.10 version, wiring and i18n", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.equal(ver, "0.8.10");
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.10");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /reg\("hpPath", String, "system.attributes.hp.value"\)/);
  assert.match(main, /get\("hpPath"\) === LEGACY_HP_PATH\) game\.settings\.set\(ID, "hpPath", DEFAULT_HP_PATH\)/);
  assert.match(main, /function doClearStuck/);
  assert.match(main, /clearStuck: \(\) =>/);
  assert.match(main, /data\.action === "clearStuck"\) doClearStuck\(\)/);
  assert.match(main, /data\.type === "stuckCleared"/);
  assert.match(main, /type: "stuckCleared", count/);
  assert.match(main, /persistNow\(\)/);
  assert.match(main, /stuck: \{ queued, dead \}/);
  assert.match(main, /action === "clearStuck"/);
  assert.match(readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8"), /clearDead: \(\) => \{ thinkingOff\(\{ broadcast: true \}\)/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /sceneTokenForActor/);
  assert.match(cmds, /kind: "string\?"/);
  assert.match(readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8"), /canRestoreResource\(actor, "rituals"\)/);
  assert.match(readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8"), /canRestoreResource\(actor, "extraResource"\)/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.match(en.settings.hpPath.hint, /system\.attributes\.hp\.value/);
  assert.equal(en.panel.clearStuck, "Clear stuck");
  assert.ok(en.panel.clearStuckConfirm.includes("{n}"));
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.10/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.10/);
  assert.match(readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8"), /v0\.8\.10/);
});
