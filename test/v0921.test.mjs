// 0.9.2: player characters stay in step with their tokens: loot to the sheet, HP written to both, linked tokens,
// linkPlayerTokens (GM only, dry run, one scene), and the setup check warning. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPlayerOwned, isUnlinkedPcToken, mirrorActor, diffActors } from "../scripts/lib/pclink.mjs";
import { runSetupCheck, findUnlinkedPcTokens, formatUnlinkedWarning } from "../scripts/lib/setupcheck.mjs";
import { panelHtml } from "../scripts/lib/gmpanel.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const msgs = [];
const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd", getProperty, escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; }, getSpeaker: () => ({ alias: "GM" }) };
function mkActor(id, name, { hp, max = 10, silver = 0, pc = true, type = "character" } = {}) {
  return { id, name, type, hasPlayerOwner: pc, items: [], made: [], system: { silver, attributes: { hp: { value: hp, max } } }, prototypeToken: { actorLink: false },
    async update(d) { for (const [k, v] of Object.entries(d)) { const ks = k.split("."); let o = this; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)] = v; } },
    async createEmbeddedDocuments(k, d) { this.made.push(...d); this.items.push(...d.map(x => ({ ...x, system: {} }))); return d; } };
}
const world = mkActor("a1", "Tempus", { hp: 10, silver: 0 });
const tokActor = mkActor("a1", "Tempus", { hp: 9, silver: 28 }); tokActor.isToken = true; tokActor.items = [{ name: "In a soggy pouch", type: "misc", system: {} }];
const tok = { id: "tT", name: "Tempus", actorLink: false, actorId: "a1", actor: tokActor, async update(d) { Object.assign(this, d); } };
const ratActor = mkActor("n1", "Bilge Rat", { hp: 3, max: 3, pc: false, type: "creature" });
const ratTok = { id: "tR", name: "Bilge Rat 1", actorLink: false, actorId: "nW", actor: ratActor, async update(d) { Object.assign(this, d); } };
const other = { id: "tO", name: "Tempus", actorLink: false, actorId: "a1", actor: mkActor("a1", "Tempus", { hp: 4 }), async update(d) { Object.assign(this, d); } };
const created = [];
const mkScene = (id, toks) => ({ id, name: id, grid: { size: 100 }, width: 3000, height: 2000, tokens: { get contents() { return toks; }, get: (i) => toks.find(t => t.id === i) ?? null, find: (f) => toks.find(f) },
  async createEmbeddedDocuments(k, data) { const made = data.map((d, i) => ({ id: "n" + (created.length + i), ...d })); created.push(...made); toks.push(...made); return made; } });
const cove = mkScene("s1", [tok, ratTok]);
const elsewhere = mkScene("s2", [other]);
const userP = { id: "p1", name: "Pat", isGM: false, active: true };
globalThis.canvas = { scene: cove, tokens: { controlled: [] } };
const table = { id: "tb", name: "Treasure", async draw() { return { results: [{ text: "In a soggy pouch: 13 silver" }] }; } };
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true, paused: false,
  settings: { get: (m, k) => ({ hpPath: "system.attributes.hp.value" })[k], set: async () => {} },
  users: { get: () => userP, find: () => null, contents: [userP], getName: () => null },
  actors: { contents: [world, ratActor], get: id => [world, ratActor].find(a => a.id === id) ?? null, getName: n => [world, ratActor].find(a => a.name === n) ?? null },
  tables: { get: () => table, getName: (n) => n === "Treasure" ? table : null }, packs: [], items: { get: () => null },
  scenes: { active: cove, viewed: cove, get: id => ({ s1: cove, s2: elsewhere })[id] ?? null },
  messages: { get contents() { return msgs; } }, socket: { emit() {} }, combat: null, combats: { get: () => null } };
const SHIP = await import("../scripts/ship.mjs"); SHIP.setLoader(async () => ({}));
const { runCommand, COMMANDS } = await import("../scripts/commands.mjs");
const ctx = { dedupe: null, persistNow: async () => {} };
const run = (name, args) => runCommand({ name, args }, ctx);
const reset = () => { world.system.attributes.hp.value = 10; tokActor.system.attributes.hp.value = 9; world.system.silver = 0; tokActor.system.silver = 28; ratActor.system.attributes.hp.value = 3; world.made.length = 0; tokActor.made.length = 0; };

test("0.9.2 pclink helpers: player-owned detection, unlinked PC tokens, mirror target, token-only differences", () => {
  assert.equal(isPlayerOwned(world), true); assert.equal(isPlayerOwned(ratActor), false);
  assert.equal(isPlayerOwned({ id: "x" }, { users: [{ id: "u", character: { id: "x" } }] }), true, "a user's assigned character");
  assert.equal(isUnlinkedPcToken(tok), true); assert.equal(isUnlinkedPcToken(ratTok), false);
  assert.equal(isUnlinkedPcToken({ ...tok, actorLink: true }), false); assert.equal(isUnlinkedPcToken({ ...tok, actorLink: undefined }), false);
  assert.equal(mirrorActor(tok), world); assert.equal(mirrorActor(ratTok), null);
  const d = diffActors(tokActor, world);
  assert.deepEqual(d.hp, { token: { value: 9, max: 10 }, world: { value: 10, max: 10 } });
  assert.deepEqual(d.silver, { token: 28, world: 0 });
  assert.deepEqual(d.items, { onlyOnToken: ["In a soggy pouch"], onlyOnWorld: [] });
  assert.deepEqual(diffActors(world, world), {});
});

test("0.9.2 end-of-fight loot: rollLoot by actorName or by tokenName puts the item and silver on the world sheet, not the unlinked PC token", async () => {
  reset();
  const r = await run("rollLoot", { actorName: "Tempus", table: "Treasure" });
  assert.equal(r.ok, true, r.error);
  assert.equal(world.system.silver, 13); assert.equal(tokActor.system.silver, 28);
  assert.equal(world.made.at(-1)?.name, "In a soggy pouch"); assert.equal(tokActor.made.length, 0);
  reset();
  const t = await run("rollLoot", { tokenName: "Tempus", table: "Treasure" }); // what GM sent at the end of the fight
  assert.equal(t.ok, true, t.error);
  assert.equal(world.system.silver, 13); assert.equal(tokActor.system.silver, 28); assert.equal(tokActor.made.length, 0);
  reset();
  const g = await run("giveLoot", { tokenId: "tT", sceneId: "s1", table: "Treasure" });
  assert.equal(g.ok, true, g.error); assert.equal(world.system.silver, 13); assert.equal(tokActor.system.silver, 28);
});

test("0.9.2 loot for monsters and NPCs with unlinked tokens still goes to the token", async () => {
  reset();
  const r = await run("giveItem", { name: "a bone", tokenId: "tR" });
  assert.equal(r.ok, true, r.error); assert.equal(ratActor.made.at(-1)?.name, "Bone");
});

test("0.9.2 HP: setHP on a PC writes the world sheet AND the unlinked token, by tokenName, tokenId and actorName", async () => {
  for (const args of [{ tokenName: "Tempus" }, { tokenId: "tT", sceneId: "s1" }, { actorName: "Tempus" }]) {
    reset();
    const r = await run("setHP", { ...args, delta: -2 });
    assert.equal(r.ok, true, r.error);
    assert.equal(tokActor.system.attributes.hp.value, 7, JSON.stringify(args)); assert.equal(world.system.attributes.hp.value, 7, JSON.stringify(args));
    assert.equal(r.result.mirrored, true);
  }
  reset();
  const heal = await run("setHP", { tokenName: "Tempus", delta: 5 }); // healing past max is clamped by the system, not here
  assert.equal(heal.ok, true); assert.equal(tokActor.system.attributes.hp.value, world.system.attributes.hp.value);
  reset();
  const v = await run("setHP", { tokenName: "Tempus", value: 4 });
  assert.equal(v.result.after, 4); assert.equal(world.system.attributes.hp.value, 4);
});

test("0.9.2 HP: applyDamage and setResource hp on a PC also reach both; monsters stay token-only", async () => {
  reset();
  const d = await run("applyDamage", { amount: 3, tokenName: "Tempus" });
  assert.equal(d.ok, true, d.error);
  assert.equal(tokActor.system.attributes.hp.value, 6); assert.equal(world.system.attributes.hp.value, 6);
  reset();
  const rs = await run("setResource", { tokenName: "Tempus", resource: "hp", delta: -1 });
  assert.equal(rs.ok, true, rs.error); assert.equal(tokActor.system.attributes.hp.value, 8); assert.equal(world.system.attributes.hp.value, 8);
  reset();
  const m = await run("setHP", { tokenName: "Bilge Rat 1", delta: -1 });
  assert.equal(m.ok, true, m.error); assert.equal(ratActor.system.attributes.hp.value, 2); assert.equal(m.result.mirrored, undefined);
  const md = await run("applyDamage", { amount: 1, tokenName: "Bilge Rat 1" });
  assert.equal(md.ok, true); assert.equal(ratActor.system.attributes.hp.value, 1);
  assert.equal(world.system.attributes.hp.value, 10, "no sync of an existing mismatch happens by itself");
});

test("0.9.2 no automatic sync: a PC mismatch is left alone until the PC is written to", async () => {
  reset();
  await run("setHP", { tokenName: "Bilge Rat 1", delta: 0 });
  assert.equal(world.system.attributes.hp.value, 10); assert.equal(tokActor.system.attributes.hp.value, 9);
  const c = src("scripts/main.mjs");
  assert.doesNotMatch(c, /linkPlayerTokens/, "never called from a hook or on load");
});

test("0.9.2 linkPlayerTokens: GM only; dryRun changes nothing and reports differences; the real run relinks PC tokens on that one scene only", async () => {
  reset(); tok.actorLink = false; other.actorLink = false; ratTok.actorLink = false;
  const dry = await run("linkPlayerTokens", { dryRun: true });
  assert.equal(dry.ok, true, dry.error); assert.equal(dry.result.dryRun, true); assert.equal(dry.result.wouldLink, 1);
  assert.equal(dry.result.sceneId, "s1"); assert.equal(dry.result.tokens[0].tokenId, "tT");
  assert.equal(dry.result.tokens[0].differences.silver.token, 28); assert.equal(dry.result.tokens[0].differences.hp.world.value, 10);
  assert.equal(tok.actorLink, false); assert.equal(world.prototypeToken.actorLink, false);
  const real = await run("linkPlayerTokens", {});
  assert.equal(real.ok, true, real.error); assert.equal(real.result.linked, 1); assert.equal(tok.actorLink, true);
  assert.equal(ratTok.actorLink, false, "monsters are never relinked"); assert.equal(other.actorLink, false, "another scene is never touched");
  assert.equal(world.system.silver, 0, "the world sheet's values win; nothing is copied from the token");
  assert.equal(world.prototypeToken.actorLink, true);
  const again = await run("linkPlayerTokens", { sceneId: "s1" });
  assert.equal(again.result.found, 0);
  const s2 = await run("linkPlayerTokens", { sceneId: "s2", dryRun: true });
  assert.equal(s2.result.sceneId, "s2"); assert.equal(s2.result.wouldLink, 1); assert.equal(other.actorLink, false);
  assert.equal((await run("linkPlayerTokens", { sceneId: "nope" })).code, 404);
  game.user.isGM = false;
  assert.equal((await run("linkPlayerTokens", {})).code, 403);
  game.user.isGM = true; tok.actorLink = false; world.prototypeToken.actorLink = false;
});

test("0.9.2 a PC token the add-on creates is linked, and the actor's prototype token is linked too", async () => {
  reset(); created.length = 0; world.prototypeToken.actorLink = false;
  const dragged = { id: "a1", name: "Tempus", ...world, prototypeToken: world.prototypeToken, async getTokenDocument(d) { return { toObject: () => ({ name: "Tempus", actorId: "a1", actorLink: world.prototypeToken.actorLink, ...d }) }; } };
  game.actors.get = (id) => id === "a1" ? Object.assign(world, { getTokenDocument: dragged.getTokenDocument }) : (id === "n1" ? ratActor : null);
  const r = await run("spawnAndVision", { actorId: "a1", x: 100, y: 100 });
  assert.equal(r.ok, true, r.error);
  assert.equal(created.at(-1).actorLink, true); assert.equal(world.prototypeToken.actorLink, true);
  ratActor.getTokenDocument = async (d) => ({ toObject: () => ({ name: "Bilge Rat", actorId: "n1", actorLink: false, ...d }) });
  const m = await run("spawnAndVision", { actorId: "n1", x: 200, y: 100 });
  assert.equal(m.ok, true, m.error); assert.equal(created.at(-1).actorLink, false, "monster tokens stay unlinked"); assert.equal(ratActor.prototypeToken.actorLink, false);
  const c = src("scripts/commands.mjs");
  assert.match(c, /pcLinkPrep\(actor\); \/\/ 0\.9\.2: a player-owned pet gets a linked token/);
  assert.match(c, /actorLink: false/.test(src("scripts/lib/testfight.mjs")) ? /pcLinkPrep/ : /x/, "enemy test-fight tokens are unrelated and stay unlinked");
});

test("0.9.2 setup check and GM panel warn when a player character's token is unlinked (and say how to fix it)", () => {
  const users = [userP];
  const unl = findUnlinkedPcTokens([tok, ratTok], users);
  assert.deepEqual(unl.map(u => u.name), ["Tempus"]);
  assert.match(formatUnlinkedWarning(unl), /not linked to the character sheet: Tempus/); assert.match(formatUnlinkedWarning(unl), /linkPlayerTokens/);
  const chk = runSetupCheck({ tokens: [tok, ratTok], users, scene: "Cove" });
  assert.equal(chk.ok, false); assert.equal(chk.unlinked.length, 1); assert.match(chk.warning, /Tempus/);
  const linked = runSetupCheck({ tokens: [{ ...tok, actorLink: true }, ratTok], users });
  assert.equal(linked.ok, true); assert.equal(linked.unlinked.length, 0); assert.match(linked.text, /linked token/);
  assert.match(panelHtml({ setup: chk }), /not linked to the character sheet/);
  assert.equal(formatUnlinkedWarning([]), null);
});

test("0.9.2 linkPlayerTokens is a registered command", () => {
  assert.ok(COMMANDS.linkPlayerTokens);
  assert.match(src("docs/bot-setup-prompt.md"), /linkPlayerTokens/);
  assert.match(src("docs/BOT-API.md"), /linkPlayerTokens \{sceneId\?, dryRun\?\}/);
});
