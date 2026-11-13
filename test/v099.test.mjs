// 0.8.20: GM-line dedupe, morale timing/targets/idempotency, ally/enemy turn clips, replay voice, caption fonts,
// mood fallback, world write lock, offline status, PC detection, roll bonuses, one card per attack, speech fixes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
import { hashStr } from "../scripts/lib/outbox.mjs";
import { resolveReplyInfo, replyGate, recordGmLine, isOocText, INFERRED_REPEAT_MS } from "../scripts/lib/replies.mjs";
import { voiceOrText } from "../scripts/lib/audioqueue.mjs";
import { combatantSide, enemyCombatants, livingEnemies, livingHostiles } from "../scripts/lib/morale.mjs";
import { createMoralePromptTracker, trackId } from "../scripts/lib/moraleprompt.mjs";
import { moraleKey, moraleKeys } from "../scripts/lib/moralelock.mjs";
import { TurnClipStore, parseClipName, resolveUpClip, upClipAudioMap, nameSlugs, bundledUpClip, BUNDLED_UP_KINDS, upSpoken } from "../scripts/lib/turnclips.mjs";
import { replaySrc, hideNativeAudio, enhanceVoiceMessage } from "../scripts/lib/voiceui.mjs";
import { availableCaptionFonts, captionFontChoices, safeFontName, cssFontFamily, applyCaptionFont, attachCaptionFontPreview } from "../scripts/lib/captions.mjs";
import { moodState, loadMoodState, rememberMood, restoreMoodKey, noteMood, moodOfPlaylist, moodSnapshot, FALLBACK_MOOD } from "../scripts/lib/mood.mjs";
import { withWorldLock, findBuiltScene, existingActorToken } from "../scripts/lib/worldlock.mjs";
import { offlinePhase, OfflineWatch, offlineNotice, DEFAULT_OFFLINE_NOTIFY_MS } from "../scripts/lib/offline.mjs";
import { deriveGmStatus, GmStatusPill, normalizeGmStatus } from "../scripts/lib/gmstatus.mjs";
import { combatantIsNpc, turnInfo } from "../scripts/lib/turns.mjs";
import { judgeWithBonus, bonusText, standingBonus, nearDuplicateRequest, findNearDuplicate, cardHtml, NEAR_DUP_MS } from "../scripts/lib/rollreq.mjs";
import { correctSpeech, parseSpeechFixes } from "../scripts/lib/ptt.mjs";
import { groupFor } from "../scripts/lib/settingsui.mjs";

// ---------- minimal Foundry ----------
const msgs = []; const cards = []; const sockets = [];
const mkMsg = (d) => { const m = { id: "m" + (msgs.length + 1), timestamp: Date.now(), ...d, async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "content") m.content = v; else if (k.startsWith("flags.")) m.flags["ai-gm-bridge"].rollRequest = v; } } }; msgs.push(m); return m; };
let fetchDelay = 0;
globalThis.fetch = async () => { if (fetchDelay) await new Promise(r => setTimeout(r, fetchDelay)); return { ok: true }; };
globalThis.foundry = { utils: { randomID: () => "rnd" + msgs.length, getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), escapeHTML: (s) => s },
  audio: { AudioHelper: { play: async () => ({ duration: 0.01, addEventListener() {} }) } } };
globalThis.ChatMessage = { async create(d) { return mkMsg(d); }, getSpeaker: () => ({ alias: "GM" }) };
globalThis.Roll = class { static validate() { return true; } constructor(f) { this.formula = f; } async evaluate() { this.total = 4; return this; } };
const userP = { id: "p1", name: "Pat", isGM: false, active: true };
const tempus = { id: "a1", name: "Tempus", type: "character", system: { attributes: { hp: { value: 5, max: 10 } } }, getRollData() { return {}; } };
const settingsStore = {};
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true,
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP], getName: n => n === "Pat" ? userP : null },
  actors: { get: id => id === "a1" ? tempus : null, getName: n => n === "Tempus" ? tempus : null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) }, socket: { emit: (c, d) => sockets.push(d) }, combat: null };
const L = await import("../scripts/lib/ship.mjs");
const SHIP = await import("../scripts/ship.mjs");
let nextRoll = [];
SHIP.setLoader(async (p) => {
  if (p.endsWith("generic-card.js")) return { showGenericCard: async (o) => { cards.push(o); } };
  if (p.endsWith("morale-outcome.js")) return { createMoraleOutcome: async ({ actor }) => { const t = nextRoll.shift() ?? 4; const s = t <= actor.morale;
    return { id: "o" + Math.random(), roll: { total: t }, isStandingFirm: s, secondaryOutcome: s ? undefined : { roll: { total: 5 } }, isFleeing: false, isSurrendering: !s }; } };
  throw new Error("no fake " + p);
});
const C = await import("../scripts/commands.mjs");
const { runCommand } = C;
const F = await import("../scripts/features.mjs");
const store = new DedupeStore();
const emitted = [];
F.initFeatures({ emit: (ev, o) => emitted.push(ev), get: (k) => ({ rollRequestTimeoutMs: 600000, rollBonuses: settingsStore.rollBonuses })[k], amLeader: () => true, dedupeOf: () => store });
const ctxOf = (extra = {}) => ({ dedupe: store, persistNow: async () => {}, ...extra });

// ---------- #1 / #9 GM line dedupe ----------
test("0.8.20 #1 a replyTo guessed from lastWake never blocks a different line; exact repeats within 20 s do", () => {
  const now = 1_000_000;
  assert.deepEqual(resolveReplyInfo("", { eventIds: ["chat:w"], at: now - 1000 }, now), { replyTo: "chat:w", inferred: true });
  assert.deepEqual(resolveReplyInfo("chat:x", { eventIds: ["chat:w"], at: now }, now), { replyTo: "chat:x", inferred: false });
  assert.equal(INFERRED_REPEAT_MS, 20000);
  const s = new DedupeStore();
  recordGmLine(s, { replyTo: "chat:w", inferred: true, content: "The sea devil lunges.", messageId: "m1", now, hash: hashStr });
  assert.equal(replyGate(s, { replyTo: "chat:w", inferred: true, content: "Harrow fires his pistol.", now: now + 1000, hash: hashStr }).duplicate, false);
  const rep = replyGate(s, { replyTo: "chat:w", inferred: true, content: "The  sea devil lunges.", now: now + 1000, hash: hashStr });
  assert.equal(rep.duplicate, true); assert.equal(rep.messageId, "m1");
  assert.equal(replyGate(s, { replyTo: "chat:w", inferred: true, content: "The sea devil lunges.", now: now + 25000, hash: hashStr }).duplicate, false);
  // explicit replyTo keeps one reply per event
  recordGmLine(s, { replyTo: "chat:e", inferred: false, content: "Aye.", messageId: "m2", now, hash: hashStr });
  assert.equal(replyGate(s, { replyTo: "chat:e", content: "Something else", now, hash: hashStr }).duplicate, true);
  assert.equal(replyGate(s, { replyTo: "chat:e", content: "Something else", allowMultiple: true, now, hash: hashStr }).duplicate, false);
});

test("0.8.20 #9 out-of-character lines never use or take the reply slot", () => {
  assert.equal(isOocText("((brb, grabbing a drink))"), true);
  assert.equal(isOocText("OOC: rules question"), true);
  assert.equal(isOocText("<p>(OOC) is that a d8?</p>"), true);
  assert.equal(isOocText("The ooze bubbles."), false);
  const s = new DedupeStore(); const now = 5;
  recordGmLine(s, { replyTo: "rollreq:r1", content: "((Yes, roll Agility))", ooc: true, messageId: "o1", now, hash: hashStr });
  assert.equal(replyGate(s, { replyTo: "rollreq:r1", content: "You dodge the claws!", now, hash: hashStr }).duplicate, false);
});

test("0.8.20 #1 postVoice: several lines in one wake all post and each gets its own audio id", async () => {
  const lastWake = { eventIds: ["chat:wake1"], at: Date.now() };
  const ctx = ctxOf({ lastWake });
  const a = await runCommand({ name: "postVoice", args: { content: "Combat begins!", audio: { ryan: "a/r1.mp3", sonia: "a/s1.mp3" } } }, ctx);
  const b = await runCommand({ name: "postVoice", args: { content: "The sea devil is up.", audio: { ryan: "a/r2.mp3", sonia: "a/s2.mp3" } } }, ctx);
  const c = await runCommand({ name: "post", args: { content: "Loot: black rum." } }, ctx);
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.ok(!a.result.duplicate && !b.result.duplicate && !c.result.duplicate);
  assert.notEqual(a.result.messageId, b.result.messageId);
  assert.equal(a.result.mode, "voice"); assert.equal(b.result.mode, "voice");
  const voice = sockets.filter(x => x.type === "voice");
  assert.equal(voice.length, 2);
  assert.notEqual(voice[0].id, voice[1].id);
  assert.match(voice[0].id, /^voice:m\d+$/);
  // retried identical line is still caught
  const again = await runCommand({ name: "postVoice", args: { content: "The sea devil is up.", audio: { ryan: "a/r2.mp3" } } }, ctx);
  assert.equal(again.result.duplicate, true);
  // voiceOrText hands the new message id to playVoice
  const seen = [];
  await voiceOrText({ audioPath: "x.mp3", checkAudio: async () => true, postVoice: async () => "mX", postText: async () => "t", playVoice: async (src, id) => seen.push(id) });
  assert.deepEqual(seen, ["mX"]);
});

test("0.8.20 #1 narration sent before requestRoll lands above the roll card; no native audio controls", async () => {
  const before = msgs.length;
  fetchDelay = 40;
  const p1 = runCommand({ name: "postVoice", args: { content: "The acolyte slashes at you!", audioPath: "a/slash.mp3", replyTo: "chat:order1" } }, ctxOf());
  const p2 = runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "agility", dr: 12, label: "Defend", requestId: "ord-1" } }, ctxOf());
  await Promise.all([p1, p2]); fetchDelay = 0;
  const added = msgs.slice(before);
  assert.match(added[0].content, /acolyte slashes/);
  assert.ok(added[1].flags["ai-gm-bridge"].rollRequest);
  assert.doesNotMatch(added[0].content, /controls/);
  assert.match(added[0].content, /<audio class="aigm-voice-src" preload="none" hidden src="a\/slash\.mp3">/);
});

test("0.8.20 #9/#15 roll slot: guessed replyTo does not lock; near-identical defend reuses the open card", async () => {
  const lastWake = { eventIds: ["rollreq:x"], at: Date.now() };
  game.combat = { id: "cbt1", started: true, round: 2, turn: 1 };
  const a = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "agility", dr: 12, label: "Defend vs Sea Devil claws" } }, ctxOf({ lastWake }));
  const b = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "agility", dr: 12, label: "Dodge the Sea Devil's jaws" } }, ctxOf({ lastWake }));
  assert.equal(b.result.duplicate, true); assert.equal(b.result.requestId, a.result.requestId);
  const str = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "strength", dr: 12, label: "Spin attack" } }, ctxOf({ lastWake }));
  assert.ok(!str.result.duplicate, "a different test in the same wake is a new card (no guessed-replyTo lock)");
  game.combat = { id: "cbt1", started: true, round: 2, turn: 2 };
  const c = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "agility", dr: 12, label: "Defend vs Acolyte B" } }, ctxOf());
  assert.ok(!c.result.duplicate, "next turn's attack gets its own card");
  const d = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "agility", dr: 12, label: "Defend again", allowDuplicate: true } }, ctxOf());
  assert.ok(!d.result.duplicate);
  game.combat = null;
  const open = { userId: "p1", actorId: "a1", stat: "agility", dr: 12, label: "A", at: 0, status: "pending" };
  assert.equal(nearDuplicateRequest(open, { ...open, label: "B" }, NEAR_DUP_MS - 1), true);
  assert.equal(nearDuplicateRequest(open, { ...open, label: "B" }, NEAR_DUP_MS + 1), false);
  assert.equal(nearDuplicateRequest(open, { ...open, label: "B", dr: 14 }, 1), false);
  assert.equal(nearDuplicateRequest({ ...open, rollKey: "atk-7" }, { ...open, rollKey: "atk-8" }, 1), false);
  assert.equal(nearDuplicateRequest({ ...open, rollKey: "atk-7" }, { ...open, label: "zzz", rollKey: "atk-7" }, 1), true);
  assert.equal(findNearDuplicate([{ ...open, status: "done" }], { ...open }, 1), null);
});

// ---------- #13 roll bonus ----------
test("0.8.20 #13 roll cards judge pass/fail including an active bonus", async () => {
  const r = judgeWithBonus({ total: 7, natural: 6, dr: 12, success: false, crit: false, fumble: false }, { stat: "agility", dr: 12, bonus: 10, bonusLabel: "test" });
  assert.equal(r.total, 7); assert.equal(r.finalTotal, 17); assert.equal(r.success, true); assert.equal(r.bonus, 10);
  assert.equal(bonusText(r), " +10 (test) = 17");
  assert.equal(judgeWithBonus({ total: 7, natural: 1, dr: 12 }, { stat: "agility", dr: 12, bonus: 10 }).success, false, "a natural 1 still fumbles");
  const html = cardHtml({ id: "r", stat: "agility", dr: 12, actorName: "Tempus", userName: "Pat", status: "done", bonus: 10, bonusLabel: "test", result: r });
  assert.match(html, /\+10 \(test\) = 17/); assert.match(html, /success/);
  assert.deepEqual(standingBonus({ "actor:a1": { bonus: 10, label: "test" } }, { actorId: "a1" }), { bonus: 10, label: "test" });
  assert.equal(standingBonus({}, { actorId: "a1" }), null);
  const set = await runCommand({ name: "setRollBonus", args: { actorName: "Tempus", bonus: 10, label: "test" } }, ctxOf());
  assert.equal(set.ok, true); assert.deepEqual(settingsStore.rollBonuses, { "actor:a1": { bonus: 10, label: "test" } });
  const req = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Tempus", stat: "presence", dr: 12, label: "Throw brand", requestId: "bon-1" } }, ctxOf());
  const card = msgs.find(m => m.id === req.result.messageId);
  assert.equal(card.flags["ai-gm-bridge"].rollRequest.bonus, 10);
  await runCommand({ name: "setRollBonus", args: { actorName: "Tempus", bonus: 0 } }, ctxOf());
  assert.deepEqual(settingsStore.rollBonuses, {});
});

// ---------- #2-#4 morale ----------
const mkActor = (id, name, type, hp, morale, extra = {}) => ({ id, name, type, system: { attributes: { hp: { value: hp, max: Math.max(hp, 1) }, morale } }, ...extra });
function moraleFight() {
  const acolyte = mkActor("acoly", "Tallow Acolyte", "creature", 1, 7);
  const tokA = { id: "tA", name: "Drowned Acolyte A", disposition: -1, actorId: "acoly" };
  const tokB = { id: "tB", name: "Drowned Acolyte B", disposition: -1, actorId: "acoly" };
  const tokL = { id: "tL", name: "Drowned Leader", disposition: -1, actorId: "acoly" };
  const synth = (tok, hp) => { const a = mkActor("acoly", tok.name, "creature", hp, 7, { token: tok }); tok.actor = a; return a; };
  synth(tokA, 1); synth(tokB, 1); synth(tokL, 0);
  const wren = mkActor("wren", "Wren Ashby", "creature", 6, 8);
  const tokW = { id: "tW", name: "Wren Ashby", disposition: -1, actorId: "wren", actor: wren, flags: { "ai-gm-bridge": { side: "ally" } } };
  const harrow = mkActor("harrow", "Lieutenant Harrow", "character", 8, null);
  const tokH = { id: "tH", name: "Lieutenant Harrow", disposition: -1, actorId: "harrow", actor: harrow };
  const crab = mkActor("crab", "Friendly Crab", "creature", 3, 5);
  const tokC = { id: "tC", name: "Friendly Crab", disposition: 1, actorId: "crab", actor: crab };
  const pc = { id: "cP", name: "Tempus", isNPC: false, actor: tempus, tokenId: "tP", token: { id: "tP" } };
  const cb = (tok, id) => ({ id, name: tok.name, isNPC: true, actor: tok.actor, tokenId: tok.id, token: tok, actorId: tok.actorId });
  const combatants = [pc, cb(tokL, "c1"), cb(tokA, "c2"), cb(tokB, "c3"), cb(tokW, "c4"), cb(tokH, "c5"), cb(tokC, "c6")];
  return { combat: { id: "khM", started: true, round: 1, turn: 1, combatants: { contents: combatants }, combatant: combatants[2] }, tokens: [tokA, tokB, tokL, tokW, tokH, tokC] };
}

test("0.8.20 #4 morale targets: living enemies of the PCs per token, never PCs or allies", () => {
  const { combat } = moraleFight();
  const sides = Object.fromEntries(combat.combatants.contents.map(c => [c.name, combatantSide(c, [userP])]));
  assert.equal(sides["Tempus"], "pc");
  assert.equal(sides["Wren Ashby"], "ally", "side flag wins over a HOSTILE token");
  assert.equal(sides["Lieutenant Harrow"], "ally", "character-type NPC is crew");
  assert.equal(sides["Friendly Crab"], "ally", "FRIENDLY token");
  assert.equal(sides["Drowned Acolyte B"], "enemy");
  assert.deepEqual(enemyCombatants(combat, [userP]).map(e => e.tokenId), ["tL", "tA", "tB"]);
  assert.deepEqual(livingEnemies(combat, [userP]).map(e => e.name), ["Drowned Acolyte A", "Drowned Acolyte B"]);
  assert.deepEqual(livingHostiles(combat, [userP]).map(e => e.tokenId), ["tA", "tB"]);
});

test("0.8.20 #3 moraleCheck: one card per creature per trigger; repeats return duplicate and post nothing", async () => {
  const f = moraleFight();
  game.combat = f.combat;
  globalThis.canvas = { scene: { tokens: { get: (id) => f.tokens.find(t => t.id === id) ?? null, find: (fn) => f.tokens.find(fn) ?? null } } };
  const before = cards.length;
  nextRoll = [5, 9];
  const r = await runCommand({ name: "moraleCheck", args: { all: true, trigger: "moraleprompt:khM:firstEnemyDown" } }, ctxOf());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.checked, 2);
  assert.deepEqual(r.result.results.map(x => x.tokenId), ["tA", "tB"]);
  assert.equal(cards.length - before, 2);
  // same trigger, a bare all:true, and a burst of parallel calls: no more cards
  const again = await runCommand({ name: "moraleCheck", args: { all: true, trigger: "moraleprompt:khM:firstEnemyDown" } }, ctxOf());
  const bare = await runCommand({ name: "moraleCheck", args: { all: true } }, ctxOf());
  const burst = await Promise.all([1, 2, 3].map(() => runCommand({ name: "moraleCheck", args: { all: true } }, ctxOf())));
  assert.equal(again.result.duplicate, true); assert.equal(bare.result.duplicate, true);
  assert.ok(burst.every(x => x.result.duplicate === true));
  assert.equal(cards.length - before, 2);
  assert.deepEqual(bare.result.results.map(x => x.result), r.result.results.map(x => x.result), "no conflicting results");
  const forced = await runCommand({ name: "moraleCheck", args: { all: true, force: true } }, ctxOf());
  assert.ok(!forced.result.duplicate); assert.equal(cards.length - before, 4);
  assert.equal(moraleKey({ trigger: "t1" }), "morale:t1");
  assert.deepEqual(moraleKeys({ combat: { id: "c" }, targets: [{ tokenId: "b" }, { tokenId: "a" }] }), ["morale:c:a,b"]);
  assert.equal(moraleKey({}), null);
  game.combat = null;
});

test("0.8.20 #2 morale resolves right away and nextTurn waits for it", async () => {
  const em = [];
  F.initFeatures({ emit: (ev) => em.push(ev), get: (k) => ({ moraleAuto: true })[k], runMorale: async (p) => { await new Promise(r => setTimeout(r, 10)); return { ok: true, result: { results: [{ name: "Drowned Acolyte A", tokenId: "tA", result: "stands", total: 5, morale: 7 }] } }; } });
  const r = await F.handleMoralePrompt({ eventId: "moraleprompt:k:firstEnemyDown", type: "moralePrompt", reason: "firstEnemyDown" });
  assert.equal(r.ok, true);
  assert.equal(em[0].resolved, true); assert.equal(em[0].results[0].result, "stands");
  F.initFeatures({ get: (k) => ({ moraleAuto: false })[k] });
  em.length = 0; F.handleMoralePrompt({ eventId: "p2", type: "moralePrompt" });
  assert.equal(em[0].eventId, "p2"); assert.equal(em[0].resolved, undefined);
  let done = false;
  C.moraleRuns.set("cX", new Promise(r => setTimeout(() => { done = true; r(); }, 20)));
  assert.equal(await C.awaitMorale("cX"), true); assert.equal(done, true);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /runMorale: \(p\) => runCommand\(\{ name: "moraleCheck", args: \{ all: true, trigger: p\.eventId/);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /await awaitMorale\(key\);\n    return combatLock\.run/);
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ rollRequestTimeoutMs: 600000 })[k] });
});

test("0.8.20 #4 morale prompt tracks unlinked tokens of one actor separately", () => {
  const { combat, tokens } = moraleFight();
  const t = createMoralePromptTracker();
  const [tokA, tokB] = tokens;
  assert.equal(trackId(tokA.actor), "tok:tA"); assert.notEqual(trackId(tokA.actor), trackId(tokB.actor));
  t.seed(tokA.actor); t.seed(tokB.actor);
  tokB.actor.system.attributes.hp.value = 0;
  const p = t.observe(tokB.actor, { combat, users: [userP] });
  assert.equal(p?.type, "moralePrompt");
  assert.ok(p.enemies.every(e => !["Wren Ashby", "Lieutenant Harrow", "Tempus"].includes(e.name)));
  // a token spawned after the seed that dies on its first update still counts
  const t2 = createMoralePromptTracker();
  const p2 = t2.observe(tokB.actor, { combat, users: [userP] });
  assert.equal(p2?.type, "moralePrompt");
});

// ---------- #12 PC detection ----------
test("0.8.20 #12 turnStatus: an unlinked PC token reading isNPC=true is still a PC", () => {
  const pat = { id: "p1", name: "Pat", isGM: false, active: true, character: { id: "a1" } };
  const synthetic = { id: "a1", name: "Tempus", type: "character", hasPlayerOwner: false, testUserPermission: () => false };
  const cb = { name: "Tempus", isNPC: true, actor: synthetic, actorId: "a1", token: { id: "tP", actor: synthetic } };
  assert.equal(combatantIsNpc(cb, [pat]), false);
  const owner = { id: "p2", name: "Pat", isGM: false, active: false };
  const owned = { ...cb, actor: { ...synthetic, testUserPermission: (u) => u.id === "p2" } };
  assert.equal(combatantIsNpc(owned, [owner]), false, "owner who is logged out still makes it a PC");
  const devil = { name: "Sea Devil", isNPC: true, actor: { id: "sd", type: "creature", testUserPermission: () => false } };
  assert.equal(combatantIsNpc(devil, [pat]), true);
  const info = turnInfo({ id: "c", started: true, round: 1, turn: 0, combatant: cb, turns: [cb] }, [pat]);
  assert.equal(info.isNPC, false);
});

// ---------- #5 turn clips ----------
test("0.8.20 #5 ally/enemy turns use recorded '<name> is up' clips in each player's voice", () => {
  assert.deepEqual(parseClipName("ai-gm-uploads/audio/9x-up-harrow-sonia.mp3"), { kind: "up", slug: "harrow", voice: "en-GB-SoniaNeural", voiceSlug: "sonia", file: "9x-up-harrow-sonia.mp3" });
  assert.equal(parseClipName("turn-tempus.mp3").kind, "turn");
  assert.deepEqual(nameSlugs("Lieutenant Harrow"), ["lieutenantharrow", "lieutenant", "harrow"]);
  const s = new TurnClipStore();
  s.put("up:harrow", "en-GB-SoniaNeural", "u/up-harrow-sonia.mp3");
  s.put("up:harrow", "en-GB-RyanNeural", "u/up-harrow-ryan.mp3");
  assert.equal(resolveUpClip("Lieutenant Harrow", "sonia", s, { side: "ally" }), "u/up-harrow-sonia.mp3");
  assert.equal(resolveUpClip("Lieutenant Harrow", "aria", s, { side: "ally" }), "u/up-harrow-ryan.mp3", "chosen voice, then Ryan");
  assert.equal(resolveUpClip("Sea Devil", "thomas", s, { side: "enemy" }), "modules/ai-gm-bridge/assets/turn-up/up-enemy-thomas.mp3");
  const map = upClipAudioMap("Lieutenant Harrow", s, { side: "ally" });
  assert.deepEqual(Object.keys(map).sort(), ["aria", "ryan", "sonia", "thomas"]);
  assert.equal(upSpoken("Harrow"), "Harrow is up.");
  for (const k of BUNDLED_UP_KINDS) for (const v of ["ryan", "thomas", "sonia", "aria"]) assert.ok(existsSync(new URL(`../${bundledUpClip(k, v).replace("modules/ai-gm-bridge/", "")}`, import.meta.url)), `${k}-${v}`);
  // store keeps Your-turn and up clips apart
  s.put("tempus", "en-GB-RyanNeural", "u/turn-tempus-ryan.mp3");
  assert.deepEqual(s.list().map(x => x.kind).sort(), ["turn", "up", "up"]);
});

test("0.8.20 #5 registerTurnClips accepts up- clips; upPrompt pings every player but not the bot", async () => {
  const ctx = ctxOf({ turnClips: new TurnClipStore() });
  const r = await runCommand({ name: "registerTurnClips", args: { clips: [{ audioPath: "ai-gm-uploads/audio/h-up-harrow-sonia.mp3" }, { audioPath: "ai-gm-uploads/audio/h-turn-tempus-aria.mp3" }] } }, ctx);
  assert.equal(r.ok, true); assert.deepEqual(r.result.registered.map(x => x.kind), ["up", "turn"]);
  assert.equal(ctx.turnClips.get("up:harrow", "sonia"), "ai-gm-uploads/audio/h-up-harrow-sonia.mp3");
  const played = [];
  F.initFeatures({ get: () => undefined, upAudio: (name, side) => upClipAudioMap(name, ctx.turnClips, { side }), queueClip: (id, clip) => played.push([id, clip]), isBot: (u) => u?.id === "bot" });
  sockets.length = 0;
  const harrowCb = { name: "Lieutenant Harrow", isNPC: true, actor: { id: "h", type: "character", testUserPermission: () => false } };
  const ping = F.upPrompt({ name: "Lieutenant Harrow", combatId: "c", round: 1, turn: 2 }, { combatant: harrowCb });
  assert.equal(ping.type, "upPing"); assert.equal(ping.side, "ally");
  assert.equal(sockets.at(-1).type, "upPing");
  assert.equal(F.shouldHearUp(ping, { user: { id: "bot" }, isBot: true }), false);
  assert.equal(F.shouldHearUp(ping, { user: userP, enabled: false }), false);
  assert.equal(F.shouldHearUp(ping, { user: userP }), true);
  assert.equal(played.length, 1, "this page played it once through the queue");
  assert.doesNotMatch(readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8"), /speechSynthesis\s*\./);
});

// ---------- #6 replay ----------
test("0.8.20 #6 replay plays the player's chosen voice; the native seek bar is hidden", () => {
  const msg = { content: "Arr.<audio src=\"a/ryan.mp3\"></audio>", flags: { "ai-gm-bridge": { audio: { ryan: "a/ryan.mp3", sonia: "a/sonia.mp3" } } } };
  assert.equal(replaySrc(msg, { slug: "sonia", fallback: "a/ryan.mp3" }), "a/sonia.mp3");
  assert.equal(replaySrc(msg, { slug: "aria", fallback: "a/ryan.mp3", cacheLookup: (t, s) => s === "aria" && t === "Arr." ? "c/aria.mp3" : null }), "c/aria.mp3");
  assert.equal(replaySrc({ content: "x", flags: {} }, { slug: "sonia", fallback: "a/only.mp3" }), "a/only.mp3");
  const audio = { attrs: { controls: "" }, removeAttribute(k) { delete this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute: () => "a/ryan.mp3", pause() {}, parentNode: { insertBefore(n) { audio.btn = n; }, childNodes: [] } };
  assert.equal(hideNativeAudio(audio), true);
  assert.equal("controls" in audio.attrs, false); assert.equal(audio.hidden, true);
  const root = { querySelector: (q) => q === "audio[src]" ? audio : (q === "[data-aigm-replay]" ? audio.btn : null),
    ownerDocument: { createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, addEventListener(t, f) { this.fn = f; } }) } };
  const plays = [];
  enhanceVoiceMessage(msg, root, { slug: "sonia", replay: (src) => plays.push(src) });
  audio.btn.fn({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(plays, ["a/sonia.mp3"]);
  assert.match(C.voiceAudioTag("x.mp3"), /^<audio class="aigm-voice-src" preload="none" hidden src="x\.mp3"><\/audio>$/);
});

// ---------- #7 caption fonts ----------
test("0.8.20 #7 caption font: only shipped fonts, live preview, applied to captions", () => {
  const fonts = availableCaptionFonts({ config: { fontDefinitions: { Signika: {}, "Modesto Condensed": {}, FontAwesome: {} }, defaultFontFamily: "Signika" },
    doc: { fonts: [{ family: '"Pirata One"' }, { family: "Font Awesome 6 Free" }, { family: "Signika" }] } });
  assert.deepEqual(fonts, ["Modesto Condensed", "Pirata One", "Signika", "serif", "sans-serif", "monospace"]);
  const ch = captionFontChoices(fonts, "Default"); assert.equal(ch[""], "Default"); assert.equal(ch.Signika, "Signika");
  assert.equal(safeFontName("Signika"), "Signika"); assert.equal(safeFontName("x;}body{"), ""); assert.equal(safeFontName("url(http://e)"), "");
  assert.equal(cssFontFamily("Pirata One"), '"Pirata One", sans-serif'); assert.equal(cssFontFamily("serif"), "serif"); assert.equal(cssFontFamily(""), "");
  const el = { style: {} }; applyCaptionFont(el, "Signika"); assert.equal(el.style.fontFamily, '"Signika", sans-serif');
  const handlers = {}; const kids = [];
  const sel = { value: "Signika", addEventListener: (t, f) => { handlers[t] = f; }, parentNode: { querySelector: () => null, appendChild: (n) => kids.push(n) } };
  const root = { querySelector: () => sel, ownerDocument: { createElement: () => ({ style: {}, dataset: {} }) } };
  const prev = attachCaptionFontPreview(root);
  assert.equal(prev.style.fontFamily, '"Signika", sans-serif');
  sel.value = "monospace"; handlers.change(); assert.equal(prev.style.fontFamily, "monospace");
  assert.equal(groupFor("captionFont"), "basic");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /register\(ID, "captionFont", \{ scope: "client", config: true/);
  assert.doesNotMatch(readFileSync(new URL("../scripts/lib/captions.mjs", import.meta.url), "utf8"), /fonts\.googleapis|https?:\/\//);
});

// ---------- #8 mood ----------
test("0.8.20 #8 after combat the music goes back to the saved mood, else last calm mood, else Calm", () => {
  loadMoodState({});
  assert.equal(rememberMood(), null);
  assert.equal(restoreMoodKey(), FALLBACK_MOOD, "nothing saved: Calm, not silence");
  noteMood("tavern", "pl1"); assert.equal(moodState().lastCalm, "tavern");
  noteMood("combat", "pl2"); // left on combat from a manual test
  assert.equal(rememberMood({ playing: { id: "pl2", name: "Combat" } }), "tavern");
  assert.equal(restoreMoodKey(), "tavern");
  // Calm started by hand still counts
  loadMoodState({});
  assert.equal(rememberMood({ playing: { id: "x", name: "Calm Seas" }, mapping: { calm: "Calm Seas" } }), "calm");
  assert.equal(moodOfPlaylist({ name: "Tavern" }), "tavern");
  // survives a reload
  noteMood("explore", "p3"); rememberMood();
  const snap = JSON.parse(JSON.stringify(moodSnapshot()));
  loadMoodState({}); loadMoodState(snap);
  assert.equal(restoreMoodKey(), "explore");
  // music off on purpose stays off
  loadMoodState({}); noteMood("none"); assert.equal(rememberMood(), "none"); assert.equal(restoreMoodKey(), "none");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /if \(!r\?\.ok && key !== "none"\) r = await applyStoredMood\("none"\)/);
  assert.match(main, /loadMoodState\(get\("moodState"\)\)/);
});

// ---------- #10 world lock ----------
test("0.8.20 #10 scene and token writes are serialized per world; builds are idempotent", async () => {
  const order = [];
  const slow = (tag, ms) => withWorldLock(async () => { order.push(`${tag}+`); await new Promise(r => setTimeout(r, ms)); order.push(`${tag}-`); });
  await Promise.all([slow("a", 20), slow("b", 1)]);
  assert.deepEqual(order, ["a+", "a-", "b+", "b-"]);
  const scenes = [{ id: "s1", name: "Cove", flags: { "ai-gm-bridge": { buildKey: "chat:map1" } } }];
  assert.equal(findBuiltScene(scenes, "chat:map1").id, "s1"); assert.equal(findBuiltScene(scenes, "x"), null);
  assert.equal(existingActorToken([{ id: "t", actorId: "harrow" }], "harrow").id, "t");
  const created = [];
  globalThis.Scene = { create: async (d) => { const s = { id: "s" + (created.length + 2), ...d, width: d.width, grid: { size: d.grid?.size }, levels: { contents: [] }, async update() {}, async activate() {} }; created.push(s); scenes.push(s); return s; } };
  game.scenes = { contents: scenes, get: (id) => scenes.find(s => s.id === id), [Symbol.iterator]: function* () { yield* scenes; } };
  const args = { name: "Saint Ivo's Cove", width: 1280, height: 720, grid: 64, buildKey: "chat:map2" };
  const [x, y] = await Promise.all([runCommand({ name: "createScene", args }, ctxOf()), runCommand({ name: "createScene", args: { ...args, width: 1600, grid: 100 } }, ctxOf())]);
  assert.equal(created.length, 1, "duplicate run did not build a second scene");
  assert.equal(y.result.duplicate, true); assert.equal(y.result.sceneId, x.result.sceneId); assert.equal(y.result.grid, 64);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  for (const w of ["withWorldLock(() => setSceneBackground", "withWorldLock(() => spawnLock.run", "withWorldLock(() => t.update(upd))", "withWorldLock(() => placePetsOnSceneNow"]) assert.ok(cmds.includes(w), w);
});

// ---------- #11 offline ----------
test("0.8.20 #11 offline status: reconnecting first, then offline + host notified; no player network calls", () => {
  const now = 10_000_000;
  assert.equal(offlinePhase({ fresh: true, now }), "online");
  assert.equal(offlinePhase({ fresh: false, lastSeen: now - 60_000, now }), "reconnecting");
  assert.equal(offlinePhase({ fresh: false, lastSeen: now - DEFAULT_OFFLINE_NOTIFY_MS, now }), "offline");
  assert.equal(offlinePhase({ fresh: false, lastSeen: 0, staleSince: now - 1000, now }), "reconnecting");
  const w = new OfflineWatch();
  w.update(false, now); assert.equal(w.noticeOnSend("reconnecting"), "reconnecting"); assert.equal(w.noticeOnSend("reconnecting"), null);
  assert.equal(w.noticeOnSend("offline"), "offline"); w.update(true, now); assert.equal(w.noticeOnSend("online"), null);
  assert.match(offlineNotice("reconnecting"), /reconnecting, your message is saved/);
  assert.match(offlineNotice("offline"), /offline, the host has been notified/);
  assert.doesNotMatch(offlineNotice("offline") + readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"), /\bPat\b/);
  assert.equal(normalizeGmStatus("reconnecting"), "reconnecting");
  const els = {}; const doc = { body: { appendChild: (e) => { els.e = e; } }, getElementById: () => els.e ?? null, createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {} }) };
  const pill = new GmStatusPill({ doc }); pill.mount();
  pill.set("reconnecting"); assert.match(els.e.textContent, /reconnecting/);
  pill.set("offline", { notified: true }); assert.match(els.e.textContent, /host notified/);
  const off = readFileSync(new URL("../scripts/lib/offline.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(off, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

// ---------- #14 speech ----------
test("0.8.20 #14 speech-to-text maps Crock-Pot and friends to Grok Bot, next to the kick fixes", () => {
  assert.equal(correctSpeech("Hey Crock-Pot, I kik him"), "Hey Grok Bot, I kick him");
  assert.equal(correctSpeech("crockpot what now"), "Grok Bot what now");
  assert.equal(correctSpeech("CROCK POT!"), "Grok Bot!");
  assert.equal(correctSpeech("ask grok bot"), "ask Grok Bot");
  assert.equal(correctSpeech("I drop cake the rat"), "I dropkick the rat");
  assert.ok(parseSpeechFixes("").some(([a, b]) => a === "crock-pot" && b === "Grok Bot"));
  assert.ok(parseSpeechFixes("kik=kick").some(([a]) => a === "crockpot"), "built in even when a world saved its own list");
});

// ---------- release ----------
test("0.8.20 release metadata", () => {
  const mod = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(mod.version, "0.8.21"); assert.equal(mod.id, "ai-gm-bridge"); assert.equal(mod.title, "AI GM Pirate Borg");
  assert.deepEqual(mod.authors.map(a => a.name), ["Gate (GateShark)"]);
  assert.match(mod.manifest, /releases\/latest\/download\/module\.json$/);
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.21");
  for (const k of ["moraleAuto", "offlineNotifyAfterMs"]) assert.equal(groupFor(k), "advanced");
  for (const k of ["rollBonuses", "moodState"]) assert.equal(groupFor(k), "hidden");
});
test.after(() => setImmediate(() => process.exit(0))); // pending roll-card timers would keep node alive
