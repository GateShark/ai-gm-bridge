// 0.9.0 runtime checks through runCommand: spendLuck, giveItem, testFight, auto-unpause on nextTurn.
import test from "node:test";
import assert from "node:assert/strict";

const msgs = [];
const settingsStore = { autoUnpause: true, aiPaused: false, moodPlaylists: "" };
const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd", getProperty, escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; }, getSpeaker: () => ({ alias: "GM" }) };
const items = [];
const tempus = { id: "a1", name: "Tempus", type: "character", isOwner: true, system: { attributes: { hp: { value: 5, max: 10 }, luck: { value: 2 } } },
  items: [], async update(d) { for (const [k, v] of Object.entries(d)) { const ks = k.split("."); let o = this; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)] = v; } },
  async createEmbeddedDocuments(k, d) { items.push(...d); return d; } };
const pcTok = { id: "tP", name: "Tempus", x: 500, y: 400, actor: tempus, actorId: "a1" };
const createdTokens = [];
const combats = [];
const scene = { id: "s1", grid: { size: 100 }, width: 3000, height: 2000,
  tokens: { contents: [pcTok], get: (id) => [pcTok, ...createdTokens].find(t => t.id === id) ?? null, find: (f) => [pcTok, ...createdTokens].find(f) },
  async createEmbeddedDocuments(k, data) { const made = data.map((d, i) => ({ id: "n" + (createdTokens.length + i), ...d })); createdTokens.push(...made); return made; } };
const rat = { id: "r1", name: "Bilge Rat", type: "creature", async getTokenDocument() { return { toObject: () => ({ name: "Bilge Rat", actorId: "r1", actorLink: true, x: 0, y: 0 }) }; } };
const calm = { id: "pl1", name: "Calm", playing: false, async playAll() { this.playing = true; }, async stopAll() { this.playing = false; } };
const pauses = [];
globalThis.canvas = { scene, tokens: { controlled: [] } };
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true, paused: true,
  togglePause(v, o) { pauses.push([v, o]); this.paused = v; },
  documentTypes: { Item: ["misc", "weapon"] },
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: () => null, find: () => null, contents: [], getName: () => null },
  actors: { contents: [tempus, rat], get: id => [tempus, rat].find(a => a.id === id) ?? null, getName: n => [tempus, rat].find(a => a.name === n) ?? null },
  playlists: { contents: [calm], get: () => null, getName: n => n === "Calm" ? calm : null },
  scenes: { active: scene, viewed: scene, get: id => id === "s1" ? scene : null },
  messages: { get contents() { return msgs; } },
  socket: { emit() {} }, combat: null, combats: { contents: combats, get: id => combats.find(c => c.id === id) ?? null } };
globalThis.Combat = { async create(d) {
  const c = { id: "c1", ...d, started: false, round: 0, turn: 0, combatants: { contents: [] }, scene: { id: d.scene },
    async createEmbeddedDocuments(k, list) { this.combatants.contents.push(...list); return list; },
    async startCombat() { this.started = true; this.round = 1; },
    get combatant() { return this.combatants.contents[this.turn] ? { name: "x" } : null },
    async nextTurn() { this.turn++; } };
  combats.push(c); globalThis.game.combat = c; return c; } };
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async () => ({}));
const { runCommand } = await import("../scripts/commands.mjs");
const ctx = { dedupe: null, persistNow: async () => {} };

test("0.9.0 spendLuck lowers Devil's Luck by one and posts one chat line; refuses at 0", async () => {
  const r = await runCommand({ name: "spendLuck", args: { actorName: "Tempus" } }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.before, 2); assert.equal(r.result.after, 1); assert.equal(tempus.system.attributes.luck.value, 1);
  assert.equal(msgs.at(-1).content, "Tempus spends a Devil's Luck (2 → 1).");
  assert.equal(msgs.at(-1).flags["ai-gm-bridge"].local, true);
  await runCommand({ name: "spendLuck", args: { actorName: "Tempus" } }, ctx);
  const n = msgs.length;
  const z = await runCommand({ name: "spendLuck", args: { actorName: "Tempus" } }, ctx);
  assert.equal(z.ok, false); assert.equal(msgs.length, n);
  assert.equal((await runCommand({ name: "spendLuck", args: { actorName: "Bilge Rat" } }, ctx)).ok, false);
});

test("0.9.0 giveItem puts a gold tooth into the PC's inventory", async () => {
  const r = await runCommand({ name: "giveItem", args: { name: "a gold tooth", actorName: "Tempus" } }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.targets[0].added, ["Gold tooth"]);
  assert.equal(items.at(-1).name, "Gold tooth"); assert.equal(items.at(-1).type, "misc");
});

test("0.9.0 testFight: Calm, three hostile rats beside the party, combat started and unpaused", async () => {
  game.paused = true; pauses.length = 0;
  const r = await runCommand({ name: "testFight", args: {} }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.mood?.toLowerCase(), "calm");
  assert.equal(r.result.tokens.length, 3); assert.equal(r.result.enemy, "Bilge Rat");
  assert.ok(createdTokens.every(t => t.disposition === -1 && t.actorLink === false));
  const c = combats[0]; assert.equal(c.started, true);
  assert.deepEqual(c.combatants.contents.map(x => x.tokenId).sort(), ["n0", "n1", "n2", "tP"]);
  assert.equal(r.result.unpaused, true); assert.deepEqual(pauses, [[false, { broadcast: true }]]);
  game.user.isGM = false;
  assert.equal((await runCommand({ name: "testFight", args: {} }, ctx)).code, 403);
  game.user.isGM = true;
});

test("0.9.0 nextTurn unpauses during play; setting off keeps it paused", async () => {
  const c = combats[0];
  game.paused = true;
  const r = await runCommand({ name: "nextTurn", args: { expect: { combatId: c.id, round: c.round, turn: c.turn } } }, ctx);
  assert.equal(r.ok, true, r.error); assert.equal(r.result.unpaused, true); assert.equal(game.paused, false);
  settingsStore.autoUnpause = false; game.paused = true;
  const r2 = await runCommand({ name: "nextTurn", args: { expect: { combatId: c.id, round: c.round, turn: c.turn } } }, ctx);
  assert.equal(r2.ok, true, r2.error); assert.equal(r2.result.unpaused, undefined); assert.equal(game.paused, true);
  settingsStore.autoUnpause = true;
});
