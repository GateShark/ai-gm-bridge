// 0.9.1: sheet writes hit the world actor (not an unlinked scene token), compact Devil's Luck row, honest testFight result.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { injectLuckTracker, luckBarSpot, LUCK_BAR_STYLE } from "../scripts/lib/devilsluck.mjs";
import { CSS } from "../scripts/lib/styles.mjs";
import { DEFAULT_TTS_VOICE, TTS_VOICES } from "../scripts/lib/voices.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const msgs = [];
const settingsStore = { autoUnpause: true, aiPaused: false, moodPlaylists: "", moodFollowsCombat: true };
const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd", getProperty, escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; }, getSpeaker: () => ({ alias: "GM" }) };
function mkActor(id, name, luck, hp) {
  return { id, name, type: "character", isOwner: true, hasPlayerOwner: true, items: [], made: [],
    system: { attributes: { hp: { value: hp, max: 10 }, luck: { value: luck } } },
    async update(d) { for (const [k, v] of Object.entries(d)) { const ks = k.split("."); let o = this; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)] = v; } },
    async createEmbeddedDocuments(k, d) { this.made.push(...d); return d; } };
}
// World Tempus (the character sheet) and the Cove's unlinked Tempus token, which keeps its own copy (same actor id).
const world = mkActor("a1", "Tempus", 3, 10);
const tokActor = mkActor("a1", "Tempus", 3, 5); tokActor.isToken = true;
const tok = { id: "tT", name: "Tempus", actorLink: false, actorId: "a1", actor: tokActor, x: 500, y: 400 };
const npcActor = mkActor("n1", "Bilge Rat", 0, 3); npcActor.type = "creature";
const npcTok = { id: "tR", name: "Bilge Rat 2", actorLink: false, actorId: "nW", actor: npcActor };
const created = [], combats = [];
const all = () => [tok, npcTok, ...created];
const scene = { id: "s1", grid: { size: 100 }, width: 3000, height: 2000,
  tokens: { get contents() { return all(); }, get: (id) => all().find(t => t.id === id) ?? null, find: (f) => all().find(f) },
  async createEmbeddedDocuments(k, data) { const made = data.map((d, i) => ({ id: "n" + (created.length + i), ...d })); created.push(...made); return made; } };
const rat = { id: "r1", name: "Bilge Rat", type: "creature", async getTokenDocument() { return { toObject: () => ({ name: "Bilge Rat", actorId: "r1", actorLink: true }) }; } };
const calm = { id: "pl1", name: "Calm", playing: false, async playAll() { this.playing = true; }, async stopAll() { this.playing = false; } };
const combatPl = { id: "pl2", name: "Combat", playing: false, async playAll() { this.playing = true; }, async stopAll() { this.playing = false; } };
globalThis.canvas = { scene, tokens: { controlled: [] } };
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true, paused: false,
  togglePause(v) { this.paused = v; }, documentTypes: { Item: ["misc", "weapon"] },
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: () => null, find: () => null, contents: [], getName: () => null },
  actors: { contents: [world, rat], get: id => [world, rat].find(a => a.id === id) ?? null, getName: n => [world, rat].find(a => a.name === n) ?? null },
  playlists: { contents: [calm, combatPl], get: () => null, getName: n => [calm, combatPl].find(p => p.name === n) ?? null },
  scenes: { active: scene, viewed: scene, get: id => id === "s1" ? scene : null },
  messages: { get contents() { return msgs; } }, socket: { emit() {} }, combat: null,
  combats: { get contents() { return combats; }, get: id => combats.find(c => c.id === id) ?? null } };
// Like Foundry: the combatStart/updateCombat hooks unpause and switch to Combat music before the command checks.
globalThis.Combat = { async create(d) {
  const c = { id: "c1", ...d, started: false, round: 0, turn: 0, combatants: { contents: [] }, scene: { id: d.scene },
    async createEmbeddedDocuments(k, list) { this.combatants.contents.push(...list); return list; },
    async startCombat() { this.started = true; this.round = 1; game.paused = false; setTimeout(() => { combatPl.playing = true; }, 20); setTimeout(() => { calm.playing = false; }, 400); /* crossfade */ },
    get combatant() { return { name: "x" }; },
    async nextTurn() { this.turn++; game.paused = false; } };
  combats.push(c); game.combat = c; return c; } };
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async () => ({}));
const { runCommand } = await import("../scripts/commands.mjs");
const ctx = { dedupe: null, persistNow: async () => {} };

test("0.9.1 #1 giveItem by actorName lands on the world sheet even with an unlinked token on the viewed scene", async () => {
  const r = await runCommand({ name: "giveItem", args: { name: "a gold tooth", actorName: "Tempus" } }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.equal(world.made.at(-1)?.name, "Gold tooth");
  assert.equal(tokActor.made.length, 0);
  const r2 = await runCommand({ name: "giveItem", args: { name: "a rusty hook", actorId: "a1" } }, ctx);
  assert.equal(r2.ok, true, r2.error); assert.equal(world.made.at(-1)?.name, "Rusty hook"); assert.equal(tokActor.made.length, 0);
});

test("0.9.1 #1 giveItem by tokenName/tokenId still writes that unlinked token for NPCs (0.9.2: a PC token resolves to the sheet)", async () => {
  const r = await runCommand({ name: "giveItem", args: { name: "a gold tooth", tokenName: "Tempus" } }, ctx);
  assert.equal(r.ok, true, r.error); assert.equal(world.made.at(-1)?.name, "Gold tooth"); assert.equal(tokActor.made.length, 0); // 0.9.2: PC token -> world sheet
  const n = world.made.length;
  const r2 = await runCommand({ name: "giveItem", args: { name: "an old map", tokenId: "tR" } }, ctx);
  assert.equal(r2.ok, true, r2.error); assert.equal(npcActor.made.at(-1)?.name, "Old map"); assert.equal(world.made.length, n);
  // a name that only a scene token has (no world actor) still finds the token
  const r3 = await runCommand({ name: "giveItem", args: { name: "a bone", actorName: "Bilge Rat 2" } }, ctx);
  assert.equal(r3.ok, true, r3.error); assert.equal(npcActor.made.at(-1)?.name, "Bone");
});

test("0.9.1 #1 spendLuck / !spendluck / world-sheet Spend change the world sheet's luck, not the token's", async () => {
  world.system.attributes.luck.value = 3; tokActor.system.attributes.luck.value = 3;
  const r = await runCommand({ name: "spendLuck", args: { actorName: "Tempus" } }, ctx); // what !spendluck Tempus sends
  assert.equal(r.ok, true, r.error);
  assert.equal(world.system.attributes.luck.value, 2); assert.equal(tokActor.system.attributes.luck.value, 3);
  assert.equal(r.result.via, undefined); assert.equal(msgs.at(-1).content, "Tempus spends a Devil's Luck (3 → 2).");
  const s = await runCommand({ name: "spendLuck", args: { actorId: "a1" } }, ctx); // what Spend on the world sheet sends
  assert.equal(s.ok, true, s.error); assert.equal(world.system.attributes.luck.value, 1); assert.equal(tokActor.system.attributes.luck.value, 3);
  const t = await runCommand({ name: "spendLuck", args: { tokenId: "tT", sceneId: "s1" } }, ctx); // Spend on the token sheet
  assert.equal(t.ok, true, t.error); assert.equal(tokActor.system.attributes.luck.value, 2); assert.equal(world.system.attributes.luck.value, 1);
  assert.equal(t.result.via, "token");
  const m = src("scripts/main.mjs");
  assert.match(m, /actor\.isToken && actor\.token \? \{ tokenId: actor\.token\.id, sceneId: actor\.token\.parent\?\.id \} : \{ actorId: actor\.id \}/);
});

test("0.9.1 #1 rollLoot/giveLoot resolve actor names to the world actor; HP by actorName still follows the scene token", async () => {
  const c = src("scripts/commands.mjs");
  assert.match(c, /function resolveLootActors[^]*?\}, \{ world: true, pcWorld: true \}\);/);
  assert.match(c, /if \(opts\.world && base\) return targetActor\(\{ baseActor: base \}\);/);
  const r = await runCommand({ name: "setHP", args: { actorName: "Tempus", delta: -1 } }, ctx); // unchanged since #13
  assert.equal(r.ok, true, r.error); assert.equal(tokActor.system.attributes.hp.value, 4); assert.equal(world.system.attributes.hp.value, 4); // 0.9.2: PC token and sheet written together
});

test("0.9.1 #3 testFight reports unpaused:true and the music actually playing after the combatStart hooks", async () => {
  game.paused = true;
  const r = await runCommand({ name: "testFight", args: {} }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.unpaused, true); assert.equal(r.result.paused, false);
  assert.equal(r.result.moodRequested, "calm");
  assert.equal(r.result.mood, "combat"); assert.ok(r.result.music.includes("Combat")); // mid-crossfade Calm may still be fading out
  await new Promise(res => setTimeout(res, 450));
});

test("0.9.1 #3 testFight with moodFollowsCombat off reports Calm; nextTurn reports unpaused after a hook unpaused first", async () => {
  settingsStore.moodFollowsCombat = false; combats.length = 0; game.combat = null; combatPl.playing = false; calm.playing = true; game.paused = true;
  globalThis.Combat.create = (orig => async (d) => { const c = await orig(d); c.startCombat = async function () { this.started = true; this.round = 1; game.paused = false; }; return c; })(globalThis.Combat.create);
  const r = await runCommand({ name: "testFight", args: {} }, ctx);
  assert.equal(r.ok, true, r.error); assert.equal(r.result.mood, "calm"); assert.deepEqual(r.result.music, ["Calm"]); assert.equal(r.result.unpaused, true);
  settingsStore.moodFollowsCombat = true;
  const c = combats[0]; game.paused = true;
  const n = await runCommand({ name: "nextTurn", args: { expect: { combatId: c.id, round: c.round, turn: c.turn } } }, ctx);
  assert.equal(n.ok, true, n.error); assert.equal(n.result.unpaused, true); assert.equal(game.paused, false);
  game.paused = false;
  const n2 = await runCommand({ name: "nextTurn", args: { expect: { combatId: c.id, round: c.round, turn: c.turn } } }, ctx);
  assert.equal(n2.result.unpaused, undefined); // was not paused: nothing to report
});

// tiny DOM (className, children, nodeName; enough for luckBarSpot)
function el(tag, cls = "") {
  const n = { nodeName: tag.toUpperCase(), nodeType: 1, className: cls, childNodes: [], dataset: {}, style: {}, listeners: {}, disabled: false, textContent: "", parentNode: null,
    get children() { return this.childNodes; },
    addEventListener(ev, f) { (this.listeners[ev] ||= []).push(f); },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; },
    get firstChild() { return this.childNodes[0] ?? null; },
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; },
    querySelector(sel) { return find(this, sel); } };
  return n;
}
function matches(n, s) {
  if (s.startsWith("[data-")) { const k = s.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return k in n.dataset; }
  if (s.startsWith(".")) return String(n.className).split(" ").includes(s.slice(1));
  return n.nodeName === s.toUpperCase();
}
function find(root, sel) {
  for (const s of sel.split(",").map(x => x.trim())) {
    const parts = s.split(" "); const last = parts.at(-1), anc = parts.length > 1 ? parts[0] : null;
    const stack = [...root.childNodes];
    while (stack.length) { const n = stack.shift();
      if (matches(n, last)) { if (!anc) return n; for (let p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) if (matches(p, anc)) return n; }
      stack.push(...n.childNodes); }
  }
  return null;
}
const doc = { createElement: (t) => el(t) };
function pbSheet() { // Pirate Borg v1 sheet: .app > header.window-header, section.window-content > form > header.sheet-header, nav.sheet-tabs, section.sheet-body
  const app = el("div", "app window-app pirateborg sheet actor"), wc = el("section", "window-content"), form = el("form", "editable flexcol");
  const head = el("header", "sheet-header"), nav = el("nav", "sheet-tabs tabs"), body = el("section", "sheet-body");
  app.append(el("header", "window-header"), wc); wc.append(form); form.append(head, nav, body);
  return { app, wc, form, head, nav, body };
}
const actor = { id: "a1", type: "character", system: { attributes: { luck: { value: 2 } } } };

test("0.9.1 #2 Devil's Luck row goes inside the form under the sheet header, never as a window-content flex child", () => {
  for (const pick of ["app", "wc", "form"]) { // render hooks may hand over the window, the content section, or the form
    const s = pbSheet();
    const bar = injectLuckTracker(s[pick], { actor, canSpend: true, doc });
    assert.ok(bar, pick);
    assert.equal(bar.parentNode, s.form, pick);
    assert.deepEqual(s.form.childNodes.map(n => n.className), ["sheet-header", "aigm-luck", "sheet-tabs tabs", "sheet-body"], pick);
    assert.equal(s.wc.childNodes.length, 1, pick);
    injectLuckTracker(s[pick], { actor, canSpend: true, doc }); // re-render refresh: still one row
    assert.equal(s.form.childNodes.filter(n => n.className === "aigm-luck").length, 1, pick);
  }
  const form = el("form"); const head = el("header", "sheet-header"); form.append(head, el("section", "sheet-body"));
  assert.deepEqual(luckBarSpot(form), { parent: form, before: form.childNodes[1] });
});

test("0.9.1 #2 compact single row: no flex grow, small height, scoped CSS", () => {
  assert.match(LUCK_BAR_STYLE, /flex:0 0 auto/); assert.match(LUCK_BAR_STYLE, /flex-grow:0/);
  assert.match(LUCK_BAR_STYLE, /max-height:26px/); assert.doesNotMatch(LUCK_BAR_STYLE, /flex:1/);
  const s = pbSheet(); const bar = injectLuckTracker(s.app, { actor, canSpend: true, doc });
  assert.equal(bar.style.cssText, LUCK_BAR_STYLE);
  // every stylesheet rule that mentions the bar is scoped to the bar itself, and none restyles sheet parts
  const rules = CSS.split("\n").filter(l => /aigm-luck/.test(l));
  assert.ok(rules.length >= 1);
  for (const r of rules) for (const sel of r.slice(0, r.indexOf("{")).split(",")) assert.match(sel.trim(), /^div\.aigm-luck\[data-aigm-luck\]/);
  assert.match(CSS, /div\.aigm-luck\[data-aigm-luck\]\{flex:0 0 auto!important;flex-grow:0!important/);
  assert.doesNotMatch(CSS, /\.window-content\s*>|\.sheet-header\{|\.sheet-body\{/);
});

test("0.9.1 #4 voice default is still Ryan; Sonia only by a player's own (client) choice; no browser speech", () => {
  assert.equal(DEFAULT_TTS_VOICE, "en-GB-RyanNeural");
  assert.equal(TTS_VOICES.filter(v => v.default).map(v => v.id).join(), "en-GB-RyanNeural");
  const m = src("scripts/main.mjs");
  assert.match(m, /register\(ID, "ttsVoice", \{ scope: "client", config: true, type: String, default: "en-GB-RyanNeural"/);
  for (const f of ["scripts/main.mjs", "scripts/commands.mjs", "scripts/features.mjs", "scripts/lib/voices.mjs", "scripts/lib/audioqueue.mjs", "scripts/lib/voiceui.mjs"])
    assert.doesNotMatch(src(f), /speechSynthesis|SpeechSynthesisUtterance/, f);
});

test("0.9.1 version, changelog, credit", () => {
  const mod = JSON.parse(src("module.json"));
  assert.equal(mod.version, "0.9.3"); assert.equal(JSON.parse(src("package.json")).version, "0.9.3");
  assert.deepEqual(mod.authors.map(a => a.name), ["Gate (GateShark)"]);
  assert.match(src("CHANGELOG.md"), /## 0\.9\.1/);
  assert.match(src("README.md"), /0\.9\.1/);
});
