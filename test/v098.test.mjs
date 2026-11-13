// 0.8.19: replay + volume + captions, setMood, morale checks/prompts, combatEnded loot.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enhanceVoiceMessage, replayId, plainVoiceText } from "../scripts/lib/voiceui.mjs";
import { clampVoiceVolume, readVoiceVolume, DEFAULT_VOICE_VOLUME, playLocalVoice } from "../scripts/lib/voices.mjs";
import { captionText, captionsEnabled, showVoiceCaption, hideVoiceCaption } from "../scripts/lib/captions.mjs";
import { normalizeMood, parseMoodPlaylists, resolveMoodPlaylist, applyMood, MOODS } from "../scripts/lib/mood.mjs";
import { parseMorale, moraleResult } from "../scripts/lib/ship.mjs";
import { readCreatureMorale, moraleIsUnbreakable, CREATURE_MORALE_PATH, combatEndSides, livingHostiles } from "../scripts/lib/morale.mjs";
import { buildMoralePrompt, createMoralePromptTracker } from "../scripts/lib/moraleprompt.mjs";
import { combatEvent } from "../scripts/lib/combatevents.mjs";
import { parseSilverText, pickDefaultLootTable, tableNameScore, planLoot } from "../scripts/lib/quickgm.mjs";
import { groupFor } from "../scripts/lib/settingsui.mjs";
import { RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";
import { COMMANDS, runCommand } from "../scripts/commands.mjs";

test("0.8.19 replay button uses the player's voice and does not look like a wake", () => {
  const html = `The skeleton swings.<audio src="a/ryan.mp3"></audio>`;
  const kids = [];
  const audio = { getAttribute: () => "a/ryan.mp3", parentNode: { insertBefore(n) { kids[0] = n; }, childNodes: [] } };
  const root = {
    querySelector: (s) => s === "audio[src]" ? audio : (s === "[data-aigm-replay]" ? kids[0] : null),
    ownerDocument: { createElement: () => { const e = { style: {}, dataset: {}, setAttribute() {}, addEventListener(t, f) { this.fn = f; }, click() { this.fn?.({ preventDefault() {}, stopPropagation() {} }); } }; return e; } }
  };
  const played = [];
  const msg = { content: html, flags: { "ai-gm-bridge": { audio: { ryan: "a/ryan.mp3", thomas: "a/thomas.mp3" } } } };
  assert.equal(enhanceVoiceMessage(msg, root, { replay: (src, meta) => played.push({ src, text: meta?.text }) }), true);
  kids[0].click();
  assert.equal(played.length, 1);
  assert.equal(played[0].src, "a/ryan.mp3");
  assert.match(played[0].text, /The skeleton swings/);
  assert.match(replayId("a/ryan.mp3", 9), /^replay:a\/ryan\.mp3:9$/);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /replay:\$\{src\}:\$\{Date\.now\(\)\}/);
  assert.match(main, /meta\?\.text/);
  assert.doesNotMatch(main, /replay[^\n]+socket\.emit/);
  assert.equal(plainVoiceText(html), "The skeleton swings.");
});

test("0.8.19 voice volume is 0-100% default 80 and applies to local playback", () => {
  assert.equal(DEFAULT_VOICE_VOLUME, 80);
  assert.equal(clampVoiceVolume(-10), 0);
  assert.equal(clampVoiceVolume(150), 100);
  assert.equal(clampVoiceVolume("nope"), 80);
  assert.equal(readVoiceVolume({ settings: { get: () => 50 } }), 0.5);
  assert.equal(readVoiceVolume({}), 0.8);
  const plays = [];
  playLocalVoice("preview.mp3", { helper: { play: (data, broadcast) => { plays.push({ data, broadcast }); return { ok: true }; } } });
  assert.equal(plays[0].data.src, "preview.mp3");
  assert.equal(plays[0].data.volume, 0.8);
  assert.equal(plays[0].broadcast, false);
  assert.equal(groupFor("voiceVolume"), "basic");
  assert.equal(groupFor("voiceCaptions"), "basic");
});

test("0.8.19 big captions show spoken text while enabled and stay off the canvas", () => {
  assert.equal(captionText('Hello <audio src="x.mp3"></audio> there'), "Hello there");
  assert.equal(captionsEnabled({ settings: { get: () => false } }), false);
  assert.equal(captionsEnabled({ settings: { get: () => true } }), true);
  const nodes = new Map();
  const doc = {
    body: { appendChild(el) { nodes.set(el.id, el); } },
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => ({ id: "", textContent: "", hidden: true, setAttribute() {} })
  };
  assert.equal(showVoiceCaption("A skeleton swings.", { doc, enabled: false }), null);
  const el = showVoiceCaption("  A skeleton <b>swings</b>. ", { doc, enabled: true });
  assert.equal(el.id, "aigm-voice-caption");
  assert.equal(el.textContent, "A skeleton swings.");
  assert.equal(el.hidden, false);
  hideVoiceCaption(doc);
  assert.equal(el.hidden, true);
  const css = readFileSync(new URL("../scripts/lib/styles.mjs", import.meta.url), "utf8");
  assert.match(css, /#aigm-voice-caption/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /bottom:88px/);
});

test("0.8.19 setMood maps playlists, auto-matches by name, and does nothing when a mapped list is missing", async () => {
  assert.deepEqual(MOODS, ["combat", "storm", "tavern", "explore", "tense", "calm", "none"]);
  assert.equal(normalizeMood("Storm"), "storm");
  assert.equal(normalizeMood("jazz"), null);
  const mapping = parseMoodPlaylists("combat=Battle Theme\nstorm=Storm at Sea");
  assert.deepEqual(mapping, { combat: "Battle Theme", storm: "Storm at Sea" });
  const lists = [
    { id: "p1", name: "Battle Theme", playing: false, playAll: async () => { lists[0].playing = true; }, stopAll: async () => { lists[0].playing = false; } },
    { id: "p2", name: "Explore the Isles", playing: false, playAll: async () => { lists[1].playing = true; }, stopAll: async () => { lists[1].playing = false; } }
  ];
  assert.equal(resolveMoodPlaylist(lists, "combat", mapping).playlist.name, "Battle Theme");
  assert.equal(resolveMoodPlaylist(lists, "explore", {}).playlist.name, "Explore the Isles");
  const missing = await applyMood("storm", { playlists: lists, mapping, playAll: async () => { throw new Error("should not play"); }, stopAll: async () => {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 404);
  assert.match(missing.error, /Storm at Sea/);
  const played = [];
  const ok = await applyMood("combat", { playlists: lists, mapping, playAll: async (p) => played.push(p.name), stopAll: async () => {} });
  assert.equal(ok.ok, true);
  assert.deepEqual(played, ["Battle Theme"]);
  const none = await applyMood("none", { playlists: [{ ...lists[0], playing: true, id: "p1", name: "Battle Theme" }], currentId: "p1", playAll: async () => {}, stopAll: async (p) => played.push("stop:" + p.name) });
  assert.equal(none.ok, true);
  assert.equal(none.mood, "none");
  assert.equal(groupFor("moodPlaylists"), "advanced");
  assert.equal(groupFor("moodFollowsCombat"), "advanced");
  assert.ok(COMMANDS.setMood);
});

test("0.8.19 morale uses system.attributes.morale; dash/none never breaks; prompts do not roll", () => {
  assert.equal(CREATURE_MORALE_PATH, "system.attributes.morale");
  assert.equal(parseMorale("-"), null);
  assert.equal(moraleIsUnbreakable("-"), true);
  assert.equal(moraleIsUnbreakable(""), true);
  assert.equal(readCreatureMorale({ system: { attributes: { morale: 7 } } }).morale, 7);
  assert.equal(readCreatureMorale({ system: { attributes: { morale: "-" } } }).unbreakable, true);
  assert.equal(moraleResult(7, 7), "stands");
  assert.equal(moraleResult(8, 7, 2), "flees");
  assert.equal(moraleResult(8, 7, 5), "surrenders");
  const skeleton = { id: "s1", name: "Skeleton", type: "creature", system: { attributes: { hp: { value: 0, max: 4 } } } };
  const rat = { id: "s2", name: "Bilge Rat", type: "creature", system: { attributes: { hp: { value: 3, max: 3 } } } };
  const hero = { id: "p1", name: "Tempus", type: "character", hasPlayerOwner: true, system: { attributes: { hp: { value: 8, max: 10 } } } };
  const combat = {
    id: "C9", round: 2, started: true,
    combatants: {
      contents: [
        { name: "Tempus", actor: hero, isNPC: false },
        { name: "Skeleton", actor: skeleton, isNPC: true },
        { name: "Bilge Rat", actor: rat, isNPC: true }
      ]
    }
  };
  const sides = combatEndSides(combat, []);
  assert.deepEqual(sides.pcs.map(r => r.name), ["Tempus"]);
  assert.deepEqual(sides.defeated.map(r => r.name), ["Skeleton"]);
  const living = livingHostiles(combat, []);
  assert.deepEqual(living.map(h => h.name), ["Bilge Rat"]);
  const ev = combatEvent(combat, "end", { users: [] });
  assert.equal(ev.type, "combat");
  assert.equal(ev.state, "end");
  assert.equal(ev.combatEnded, true);
  assert.equal(ev.defeated[0].name, "Skeleton");
  assert.equal(ev.pcs[0].name, "Tempus");
  const st = { first: false, half: false };
  const hostiles = [
    { name: "Skeleton", actorId: "s1", hp: 0, max: 4 },
    { name: "Rat", actorId: "s2", hp: 3, max: 3 },
    { name: "Crab", actorId: "s3", hp: 2, max: 2 },
    { name: "Gull", actorId: "s4", hp: 1, max: 1 }
  ];
  const first = buildMoralePrompt({ id: "C9", round: 2 }, hostiles, st);
  assert.equal(first.type, "moralePrompt");
  assert.equal(first.reason, "firstEnemyDown");
  assert.ok(!first.reasons.includes("halfDown"));
  hostiles[1].hp = 0;
  const half = buildMoralePrompt({ id: "C9", round: 2 }, hostiles, st);
  assert.equal(half.reason, "halfDown");
  assert.equal(buildMoralePrompt({ id: "C9", round: 2 }, hostiles, st), null);
  const tracker = createMoralePromptTracker();
  const a = { id: "e1", name: "Skeleton", system: { attributes: { hp: { value: 4, max: 4 } } } };
  const cbt = { id: "C1", started: true, round: 1, combatants: { contents: [{ name: "Skeleton", actor: a, isNPC: true }] } };
  tracker.seed(a);
  a.system.attributes.hp.value = 0;
  const prompt = tracker.observe(a, { combat: cbt, users: [], enabled: true });
  assert.equal(prompt.type, "moralePrompt");
  assert.deepEqual(prompt.reasons.sort(), ["firstEnemyDown", "halfDown"].sort());
  assert.ok(RELAY_AUTO_ACK_TYPES.includes("moralePrompt"));
  assert.equal(groupFor("moralePrompts"), "advanced");
});

test("0.8.19 rollLoot finds Treasure-style tables and awards items or silver", async () => {
  assert.ok(tableNameScore("Treasure") > tableNameScore("Cargo"));
  assert.equal(pickDefaultLootTable([{ name: "Weather" }, { name: "Treasure" }, { name: "Cargo" }]).name, "Treasure");
  assert.deepEqual(parseSilverText("You find 12 silver pieces"), { amount: 12, formula: null });
  assert.deepEqual(parseSilverText("2d6 silver in a pouch"), { formula: "2d6", amount: null });
  assert.equal(parseSilverText("a rusty hook").amount, 0);
  const planned = planLoot([{ type: "Item", name: "Cutlass", documentUuid: "Item.cut" }, { text: "15 silver" }]);
  assert.equal(planned.items[0].name, "Cutlass");
  assert.deepEqual(planned.texts, ["15 silver"]);
  assert.ok(COMMANDS.rollLoot);
  assert.ok(COMMANDS.giveLoot);
  const actor = {
    id: "p1", name: "Tempus", system: { silver: 3 }, items: [],
    async createEmbeddedDocuments(type, docs) { this.items.push(...docs); },
    async update(u) { this.system.silver = u["system.silver"]; }
  };
  const table = {
    id: "tb", name: "Treasure",
    async draw() {
      return { results: [{ type: "Item", name: "Cutlass", documentUuid: "Item.cut" }, { text: "12 silver" }] };
    }
  };
  globalThis.fromUuid = async () => ({ name: "Cutlass", toObject: () => ({ name: "Cutlass", type: "weapon" }) });
  const prev = globalThis.game;
  globalThis.game = {
    tables: { get: () => table, getName: (n) => n === "Treasure" ? table : null },
    packs: [],
    items: { get: () => null },
    actors: { get: () => actor, getName: () => actor }
  };
  try {
    const r = await runCommand({ name: "rollLoot", args: { table: "Treasure", actorName: "Tempus", toChat: false } }, {});
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.table, "Treasure");
    assert.equal(r.result.targets[0].silver, 12);
    assert.deepEqual(r.result.targets[0].added, ["Cutlass"]);
    assert.equal(actor.system.silver, 15);
  } finally {
    globalThis.game = prev;
    delete globalThis.fromUuid;
  }
});

test("0.8.19 version, docs, settings and no browser speech", () => {
  const mj = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(mj.version, "0.8.20");
  assert.equal(mj.title, "AI GM Pirate Borg");
  assert.match(readFileSync(new URL("../package.json", import.meta.url), "utf8"), /"version": "0\.8\.20"/);
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.match(log, /## 0\.8\.19/);
  assert.match(log, /setMood/);
  assert.match(log, /rollLoot/);
  assert.match(log, /moraleCheck/);
  const api = readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8");
  assert.match(api, /v0\.8\.19/);
  assert.match(api, /setMood/);
  assert.match(api, /rollLoot/);
  assert.match(api, /moralePrompt/);
  assert.match(api, /combatEnded/);
  assert.match(api, /system\.attributes\.morale/);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /register\(ID, "voiceVolume"/);
  assert.match(main, /default: 80/);
  assert.match(main, /register\(ID, "voiceCaptions"/);
  assert.match(main, /reg\("moodPlaylists", String, ""\)/);
  assert.match(main, /reg\("moodFollowsCombat", Boolean, true\)/);
  assert.match(main, /reg\("moralePrompts", Boolean, true\)/);
  assert.doesNotMatch(main, /speechSynthesis/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /v0\.8\.20/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /Alpha/);
  const scripts = ["scripts/commands.mjs", "scripts/features.mjs", "scripts/main.mjs", "scripts/lib/voices.mjs"];
  for (const f of scripts) assert.doesNotMatch(readFileSync(new URL("../" + f, import.meta.url), "utf8"), /speechSynthesis/, f);
});
