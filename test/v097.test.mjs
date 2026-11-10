// 0.8.17: roll lag/dedupe, player-visible GM status, PTT logo+drag, speech fixes, voiced turns, d4 cards.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, looksLikeAbilityRoll } from "../scripts/lib/filter.mjs";
import { resolveReplyTo, priorReply, recordReply, priorRollReply, recordRollReply, replyKey, rollReplyKey } from "../scripts/lib/replies.mjs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
import { normalizeFormula, diceFaces, cardHtml, matchRoll } from "../scripts/lib/rollreq.mjs";
import { turnVoiceUserIds, voiceUsersFrom } from "../scripts/lib/turns.mjs";
import { correctSpeech, parseSpeechFixes, DEFAULT_SPEECH_FIXES, PushToTalk, clampPttPosition, applyPttPosition, PTT_DRAG_PX } from "../scripts/lib/ptt.mjs";
import { deriveGmStatus, normalizeGmStatus, formatElapsed, ACTIVITY_STATES } from "../scripts/lib/gmstatus.mjs";
import { formatPanelLink } from "../scripts/lib/presence.mjs";
import { ThinkingIndicator } from "../scripts/lib/thinking.mjs";
import { groupFor } from "../scripts/lib/settingsui.mjs";
import { COMMANDS, runCommand } from "../scripts/commands.mjs";
import { TTS_VOICES, DEFAULT_TTS_VOICE, resolveTtsVoice, findTtsVoice, listTtsVoices, ttsVoiceSlug, voicePreviewSrc, pickAudioSrc, readUserVoiceSlug } from "../scripts/lib/voices.mjs";
import { turnClipSlug, turnClipFile, parseTurnClipName, resolveTurnClip, turnClipAudioMap, TurnClipStore } from "../scripts/lib/turnclips.mjs";

test("0.8.17 ability rolls wake urgently; damage dice stay plainRoll", () => {
  const base = { botUserId: "bot", ignorePlainRolls: true };
  assert.equal(looksLikeAbilityRoll([{ formula: "1d20 + @abilities.agility.value" }]), true);
  assert.equal(looksLikeAbilityRoll([{ formula: "1d8" }]), false);
  const agi = classify({ text: "", rolls: [{ formula: "1d20+@abilities.agility.value", total: 10 }] }, base);
  assert.deepEqual(agi, { wake: true, reason: "roll", urgent: true });
  assert.equal(classify({ text: "", rolls: [{ formula: "1d8", total: 5 }] }, base).reason, "plainRoll");
  const dmg = classify({ text: "", rolls: [{ formula: "1d8", total: 5 }] }, { ...base, ignorePlainRolls: false });
  assert.equal(dmg.wake, true); assert.equal(dmg.urgent, true);
});

test("0.8.17 resolveReplyTo and separate reply/roll locks", () => {
  const now = 1_000_000;
  assert.equal(resolveReplyTo("chat:explicit", { eventIds: ["chat:old"], at: now }, now), "chat:explicit");
  assert.equal(resolveReplyTo("", { eventIds: ["chat:wake"], at: now - 1000 }, now), "chat:wake");
  assert.equal(resolveReplyTo(null, { eventIds: ["chat:wake"], at: now - 200_000 }, now), null);
  const store = new DedupeStore();
  recordReply(store, "chat:1", "m1", now);
  recordRollReply(store, "chat:1", "rr1", "m2", now);
  assert.equal(priorReply(store, "chat:1"), "m1");
  assert.equal(priorRollReply(store, "chat:1").requestId, "rr1");
  assert.notEqual(replyKey("chat:1"), rollReplyKey("chat:1"));
});

test("0.8.17 formulas normalize d4; timeout cards keep the player button; unflagged d4 matches", () => {
  assert.equal(normalizeFormula("d4"), "1d4");
  assert.equal(normalizeFormula("1d4"), "1d4");
  assert.deepEqual(diceFaces("1d4"), [4]);
  const html = cardHtml({ id: "r1", stat: "agility", dr: 12, actorName: "Bart", userName: "Pat", label: "", status: "timeout" });
  assert.match(html, /Still waiting/);
  assert.match(html, /data-aigm-roll="r1">Roll Agility/);
  assert.match(html, /data-gm-only="1"/);
  const now = Date.now();
  const pending = [{ id: "brk", formula: "1d4", label: "Broken", userId: "p1", actorId: "a1", at: now - 10, status: "pending" }];
  assert.equal(matchRoll({ rolls: [{ formula: "1d4", total: 3 }], author: { id: "p1" }, timestamp: now, flags: {} }, pending)?.id, "brk");
  assert.equal(matchRoll({ rolls: [{ formula: "1d20", total: 9 }], author: { id: "p1" }, timestamp: now, flags: {} }, pending), null);
});

const msgs = []; const emitted = [];
const mkMsg = (d) => { const m = { id: "m" + (msgs.length + 1), timestamp: Date.now(), ...d, async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "content") m.content = v; else if (k.startsWith("flags.")) m.flags["ai-gm-bridge"].rollRequest = v; } } }; msgs.push(m); return m; };
const actorDoc = { id: "a1", name: "Bart", type: "character", getRollData() { return { abilities: { agility: { value: 1 } } }; } };
const userP = { id: "p1", name: "Pat" };
globalThis.foundry = { utils: { randomID: () => "rnd" + msgs.length, getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { return mkMsg(d); }, getSpeaker: () => ({}) };
globalThis.Roll = class { static validate(f) { return !/bogus/.test(f); } constructor(f) { this.formula = f; } async evaluate() { this.total = 4; return this; } };
globalThis.game = { system: { id: "pirateborg" }, user: { id: "gm", isGM: true }, settings: { get: () => undefined },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP], getName: n => n === "Pat" ? userP : null },
  actors: { get: id => id === "a1" ? actorDoc : null, getName: n => n === "Bart" ? actorDoc : null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) }, socket: { emit() {} } };
const F = await import("../scripts/features.mjs");
const store = new DedupeStore();
F.initFeatures({ emit: (ev, o) => emitted.push([ev, o]), get: (k) => ({ rollRequestTimeoutMs: 600000 })[k], amLeader: () => true, dedupe: store });

test("0.8.17 requestRoll accepts d4, dedupes open cards, locks on replyTo", async () => {
  const r = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", formula: "d4", label: "Broken", requestId: "brk1" } }, { dedupe: store, persistNow: async () => {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = msgs.at(-1).flags["ai-gm-bridge"].rollRequest;
  assert.equal(req.formula, "1d4");
  assert.match(msgs.at(-1).content, /Roll 1d4/);
  const n = msgs.length;
  const dup = await runCommand({ name: "requestRoll", args: { user: "Pat", actorName: "Bart", formula: "1d4", label: "Broken", requestId: "brk2" } }, { dedupe: store, persistNow: async () => {} });
  assert.equal(dup.result.duplicate, true);
  assert.equal(dup.result.requestId, "brk1");
  assert.equal(msgs.length, n);
  const first = await F.requestRoll({ user: "Pat", actorName: "Bart", formula: "1d6", label: "Other", requestId: "oth1", replyTo: "chat:roll" });
  assert.equal(first.ok, true);
  const locked = await F.requestRoll({ user: "Pat", actorName: "Bart", formula: "2d6", label: "Else", requestId: "oth2", replyTo: "chat:roll" });
  assert.equal(locked.result.duplicate, true);
  assert.equal(locked.result.requestId, first.result.requestId);
});

test("0.8.17 cancelRoll finds siblings and messageId", async () => {
  msgs.length = 0;
  const a = await F.requestRoll({ user: "Pat", actorName: "Bart", formula: "1d4", label: "Broken", requestId: "c1" });
  // Force a second card with a different formula so sameOpen doesn't collapse, then cancel by sibling match via same label after tweaking? 
  // Same label+formula would dedupe. Create two cards with same target by writing flags directly.
  const seed = msgs.at(-1);
  const twinReq = { ...seed.flags["ai-gm-bridge"].rollRequest, id: "c2" };
  const twin = await mkMsg({ flags: { "ai-gm-bridge": { rollRequest: twinReq } }, content: "twin" });
  const r = await F.cancelRollRequest("c1");
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "cancelled");
  assert.equal(r.result.requestId, "c1");
  assert.ok(r.result.cancelled.some(x => x.requestId === "c2"));
  assert.match(seed.content, /Cancelled/);
  assert.match(twin.content, /Cancelled/);
  const miss = await F.cancelRollRequest("nope");
  assert.equal(miss.ok, false);
  const byMsg = await F.requestRoll({ user: "Pat", actorName: "Bart", formula: "2d4", label: "Luck", requestId: "c3" });
  const card = msgs.at(-1);
  const r2 = await runCommand({ name: "cancelRoll", args: { messageId: card.id } }, {});
  assert.equal(r2.ok, true);
  assert.equal(r2.result.status, "cancelled");
});

test("0.8.17 voiced turn prompt defaults to every owner", () => {
  assert.deepEqual(voiceUsersFrom(" Pat, LEE ,,"), ["pat", "lee"]);
  assert.deepEqual(turnVoiceUserIds(["p1", "p2"], { voiceTurnPrompt: true, turnVoiceUsers: "", users: [{ id: "p1", name: "Pat" }, { id: "p2", name: "Lee" }] }), ["p1", "p2"]);
  assert.deepEqual(turnVoiceUserIds(["p1", "p2"], { voiceTurnPrompt: false, turnVoiceUsers: "", users: [] }), []);
  assert.deepEqual(turnVoiceUserIds(["p1", "p2"], { voiceTurnPrompt: true, turnVoiceUsers: "Lee", users: [{ id: "p1", name: "Pat" }, { id: "p2", name: "Lee" }] }), ["p2"]);
});

test("0.8.17 speech correction: drop cake and Kik, no extra mappings", () => {
  assert.equal(correctSpeech("I drop cake him"), "I dropkick him");
  assert.equal(correctSpeech("Kik the door"), "Kick the door");
  assert.equal(correctSpeech("I pulled up behind the crate"), "I ducked behind the crate");
  assert.equal(correctSpeech("slash the pirate"), "slash the pirate");
  assert.ok(DEFAULT_SPEECH_FIXES.some(([from, to]) => from === "pulled up behind" && to === "ducked behind"));
  assert.ok(!DEFAULT_SPEECH_FIXES.some(([from]) => /kike/i.test(from)));
  assert.ok(parseSpeechFixes("foo=bar").some(([a, b]) => a === "foo" && b === "bar"));
});

function el(tag) { const l = {}; return { tagName: tag.toUpperCase(), style: {}, l, addEventListener(t, f) { (l[t] ??= []).push(f); }, fire(t, e = {}) { for (const f of l[t] ?? []) f(e); }, removed: false, remove() { this.removed = true; doc.body.kids = doc.body.kids.filter(k => k !== this); } }; }
let doc; const mkDoc = () => { const l = {}; doc = { l, body: { kids: [], appendChild(e) { this.kids.push(e); } }, createElement: el, addEventListener(t, f) { (l[t] ??= []).push(f); }, removeEventListener(t, f) { l[t] = (l[t] ?? []).filter(x => x !== f); } }; return doc; };
class FakeRec { constructor() { FakeRec.last = this; this.started = 0; } start() { this.started++; } stop() { this.onend?.(); } say(parts) { this.onresult?.({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }); } }

test("0.8.17 PTT logo, drag persists, hold-to-talk still posts", async () => {
  assert.equal(PTT_DRAG_PX, 8);
  const pos = clampPttPosition(-10, 9999, { vw: 200, vh: 200, size: 48 });
  assert.equal(pos.x, 0); assert.equal(pos.y, 152);
  const moved = []; const posted = [];
  const p = new PushToTalk({ win: { webkitSpeechRecognition: FakeRec, innerWidth: 800, innerHeight: 600 }, doc: mkDoc(), post: async t => posted.push(t), t: k => k, logoSrc: "modules/ai-gm-bridge/assets/logo-256.webp", onMove: x => moved.push(x) });
  assert.equal(p.install(), true);
  const b = doc.body.kids.find(k => k.id === "aigm-ptt-button");
  assert.match(b.innerHTML, /logo-256\.webp/);
  b.fire("pointerdown", { preventDefault() {}, clientX: 20, clientY: 20 });
  FakeRec.last.say([["roll for me", true]]);
  b.fire("pointerup");
  await new Promise(s => setImmediate(s));
  assert.deepEqual(posted, ["roll for me"]);
  posted.length = 0;
  b.fire("pointerdown", { preventDefault() {}, clientX: 10, clientY: 10 });
  FakeRec.last.say([["drop cake", true]]);
  for (const f of doc.l.pointermove ?? []) f({ clientX: 40, clientY: 50 });
  b.fire("pointerup");
  await new Promise(s => setImmediate(s));
  assert.deepEqual(posted, []);
  assert.ok(moved.length);
  applyPttPosition(b, moved.at(-1));
  assert.match(b.style.left, /px/);
});

test("0.8.17 GM status states, aliases, elapsed, setGmStatus", async () => {
  assert.equal(normalizeGmStatus("sendingVoice"), "voicing");
  assert.equal(normalizeGmStatus("idle"), "listening");
  assert.equal(deriveGmStatus({ enabled: true, thinking: true, botActive: true }), "thinking");
  assert.equal(deriveGmStatus({ enabled: true, activity: "waking", botActive: true }), "waking");
  assert.equal(deriveGmStatus({ enabled: true, sendingVoice: true, botActive: true }), "voicing");
  assert.equal(deriveGmStatus({ enabled: true, botActive: true }), "listening");
  assert.ok(ACTIVITY_STATES.includes("voicing"));
  assert.equal(formatElapsed(1000, 13000), "12s");
  assert.equal(formatPanelLink({ state: "voicing" }), "GM is sending a voice message…");
  assert.equal(formatPanelLink({ state: "waking", since: 1000, now: 4000 }), "GM waking up (3s)");
  assert.equal(formatPanelLink({ state: "listening" }), "GM listening");
  const tip = new ThinkingIndicator({ silent: true, now: () => 5000, setT: () => 1, clearT() {} });
  tip.show(90000, { kind: "waking" }); assert.equal(tip.kind, "waking"); assert.ok(tip.visible);
  tip.show(90000, { kind: "reading" }); assert.equal(tip.kind, "reading");
  tip.hide(); assert.equal(tip.visible, false);
  assert.ok(COMMANDS.setGmStatus);
  const ok = await runCommand({ name: "setGmStatus", args: { state: "voicing", note: "tts" } }, {});
  assert.equal(ok.ok, true); assert.equal(ok.result.state, "voicing"); assert.equal(ok.result.note, "tts");
  assert.equal((await runCommand({ name: "setGmStatus", args: { state: "nope" } }, {})).ok, false);
});


test("0.8.18 TTS voices are one swap-friendly list with Ryan as default", async () => {
  assert.equal(DEFAULT_TTS_VOICE, "en-GB-RyanNeural");
  assert.deepEqual(TTS_VOICES.map(v => v.id), ["en-GB-RyanNeural", "en-GB-ThomasNeural", "en-GB-SoniaNeural", "en-US-AriaNeural"]);
  assert.equal(TTS_VOICES.filter(v => v.default).length, 1);
  assert.equal(resolveTtsVoice(""), "en-GB-RyanNeural");
  assert.equal(resolveTtsVoice("Ryan"), "en-GB-RyanNeural");
  assert.equal(resolveTtsVoice("sonia"), "en-GB-SoniaNeural");
  assert.equal(resolveTtsVoice("en-US-AriaNeural"), "en-US-AriaNeural");
  assert.equal(resolveTtsVoice("Thomas Neural"), "en-GB-ThomasNeural");
  assert.equal(resolveTtsVoice("thomas"), "en-GB-ThomasNeural");
  assert.equal(resolveTtsVoice("Christopher"), "Christopher");
  assert.equal(resolveTtsVoice("custom-other"), "custom-other");
  assert.equal(findTtsVoice("Aria").label, "Aria (American woman)");
  assert.equal(ttsVoiceSlug("en-GB-ThomasNeural"), "thomas");
  assert.equal(voicePreviewSrc("Sonia"), "modules/ai-gm-bridge/assets/voice-preview/voice-sonia.mp3");
  const listed = listTtsVoices();
  assert.equal(listed.length, 4);
  assert.deepEqual(listed.map(v => v.slug), ["ryan", "thomas", "sonia", "aria"]);
  assert.equal(listed[0].preview, "modules/ai-gm-bridge/assets/voice-preview/voice-ryan.mp3");
  listed[0].id = "mutated";
  assert.equal(TTS_VOICES[0].id, "en-GB-RyanNeural");
  assert.ok(COMMANDS.listVoices);
  const r = await runCommand({ name: "listVoices" }, {});
  assert.equal(r.ok, true);
  assert.equal(r.result.default, "en-GB-RyanNeural");
  assert.equal(r.result.selected, "en-GB-RyanNeural");
  assert.deepEqual(r.result.voices.map(v => v.name), ["Ryan", "Thomas", "Sonia", "Aria"]);
  for (const slug of ["ryan", "thomas", "sonia", "aria"]) {
    assert.ok(existsSync(new URL(`../assets/voice-preview/voice-${slug}.mp3`, import.meta.url)), slug);
  }
});

test("0.8.18 turn clips use turn-<name>-<voice>.mp3 and fall back through Ryan", async () => {
  assert.equal(turnClipSlug("Tempus"), "tempus");
  assert.equal(turnClipSlug("Sea Chest"), "seachest");
  assert.equal(turnClipSlug("Sea-Chest"), "seachest");
  assert.equal(turnClipSlug(""), "generic");
  assert.equal(turnClipFile("Tempus", "thomas"), "turn-tempus-thomas.mp3");
  assert.deepEqual(parseTurnClipName("turn-tempus-thomas.mp3"), { slug: "tempus", voice: "en-GB-ThomasNeural", voiceSlug: "thomas", file: "turn-tempus-thomas.mp3" });
  assert.equal(parseTurnClipName("ai-gm-uploads/audio/ab12-turn-tempus.mp3").voice, "en-GB-RyanNeural");
  assert.equal(parseTurnClipName("voice-ryan.mp3"), null);
  const store = new TurnClipStore();
  const ctx = { turnClips: store, persistTurnClips() { ctx.saved = true; } };
  const r = await runCommand({ name: "registerTurnClips", args: { clips: [
    { audioPath: "ai-gm-uploads/audio/h1-turn-tempus-thomas.mp3" },
    { audioPath: "ai-gm-uploads/audio/h2-turn-tempus.mp3" },
    { audioPath: "ai-gm-uploads/audio/h3-turn-generic-sonia.mp3" },
    { audioPath: "uploads/x.mp3", file: "turn-seachest-aria.mp3" }
  ] } }, ctx);
  assert.equal(r.ok, true);
  assert.equal(ctx.saved, true);
  assert.equal(r.result.registered.length, 4);
  assert.equal(resolveTurnClip("Tempus", "thomas", store), "ai-gm-uploads/audio/h1-turn-tempus-thomas.mp3");
  assert.equal(resolveTurnClip("Tempus", "Ryan", store), "ai-gm-uploads/audio/h2-turn-tempus.mp3");
  assert.equal(resolveTurnClip("Unknown PC", "sonia", store), "ai-gm-uploads/audio/h3-turn-generic-sonia.mp3");
  assert.equal(resolveTurnClip("Sea Chest", "aria", store), "uploads/x.mp3");
  assert.equal(resolveTurnClip("Tempus", "sonia", store), "ai-gm-uploads/audio/h3-turn-generic-sonia.mp3");
  const onlyThomas = new TurnClipStore();
  onlyThomas.put("tempus", "thomas", "t-tempus-thomas.mp3");
  assert.equal(resolveTurnClip("Tempus", "sonia", onlyThomas), null);
  onlyThomas.put("tempus", "ryan", "t-tempus-ryan.mp3");
  assert.equal(resolveTurnClip("Tempus", "sonia", onlyThomas), "t-tempus-ryan.mp3");
  onlyThomas.put("generic", "ryan", "t-generic-ryan.mp3");
  assert.equal(resolveTurnClip("Unknown", "aria", onlyThomas), "t-generic-ryan.mp3");
  assert.equal(turnClipAudioMap("Tempus", store).thomas, "ai-gm-uploads/audio/h1-turn-tempus-thomas.mp3");
  assert.equal(pickAudioSrc({ thomas: "a-t.mp3", ryan: "a-r.mp3" }, "sonia"), "a-r.mp3");
  assert.equal(pickAudioSrc({ thomas: "a-t.mp3" }, "thomas", "legacy.mp3"), "a-t.mp3");
  assert.equal(pickAudioSrc(null, "thomas", "legacy.mp3"), "legacy.mp3");
  const listed = await runCommand({ name: "listTurnClips" }, ctx);
  assert.equal(listed.result.clips.length, 4);
  assert.equal((await runCommand({ name: "registerTurnClips", args: {} }, ctx)).ok, false);
});
test("0.8.18 settings grouping, title, version and docs", () => {
  for (const k of ["voiceTurnPrompt", "speechHints", "speechFixes"]) assert.equal(groupFor(k), "advanced", k);
  assert.equal(groupFor("ttsVoice"), "basic");
  assert.equal(groupFor("turnClips"), "hidden");
  assert.equal(groupFor("pttPosition"), "hidden");
  const mj = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(mj.id, "ai-gm-bridge");
  assert.equal(mj.title, "AI GM Pirate Borg");
  assert.equal(mj.version, "0.8.18");
  assert.match(mj.url, /GateShark\/ai-gm-bridge/);
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.18");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /AI GM Pirate Borg/);
  assert.match(readme, /Previously called AI GM Bridge/);
  assert.match(readme, /Alpha/);
  assert.match(readme, /Gate \(GateShark\)/);
  assert.doesNotMatch(readme, /Kevin|Allen/);
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.match(log, /## 0\.8\.18/);
  assert.match(log, /## 0\.8\.17/);
  assert.match(log, /AI GM Pirate Borg/);
  const api = readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8");
  assert.match(api, /setGmStatus/);
  assert.match(api, /listVoices/);
  assert.match(api, /registerTurnClips/);
  assert.match(api, /voicePrefs/);
  assert.match(api, /gmVoice/);
  assert.match(api, /turn-tempus-thomas/);
  assert.match(api, /en-GB-RyanNeural/);
  assert.match(api, /en-GB-ThomasNeural/);
  assert.match(api, /voice-ryan/);
  assert.match(api, /AI GM Pirate Borg/);
  assert.match(api, /ai-gm-bridge/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.equal(en.panel.title, "AI GM Pirate Borg");
  for (const k of ["asleep", "waking", "reading", "rolling", "voicing", "speaking"]) assert.ok(en.status[k], k);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /thinkingOn\(\{ kind: "waking" \}\)/);
  assert.match(main, /setGmStatus/);
  assert.match(main, /name !== "ping"/);
  assert.match(readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8"), /Your turn:/);
  assert.match(readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8"), /D\.turnAudio/);
  const cfg = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.match(cfg, /data-aigm-voice-preview/);
  assert.match(cfg, /ttsVoice/);
  assert.match(cfg, /\[name=ttsVoice\].*addEventListener\("change"/s);
  assert.match(main, /register\(ID, "ttsVoice"/);
  assert.match(main, /scope: "client"/);
  assert.match(main, /syncGmVoiceFlag/);
  assert.match(main, /gmVoice/);
  assert.doesNotMatch(main, /reg\("ttsVoice"/);
});

test("0.8.18 voicePrefs uses gmVoice flags and defaults to ryan", async () => {
  const prev = globalThis.game;
  globalThis.game = { users: [
    { id: "u1", name: "Pat", active: true, flags: { "ai-gm-bridge": { gmVoice: "thomas" } }, getFlag: (ns, k) => ns === "ai-gm-bridge" && k === "gmVoice" ? "thomas" : undefined },
    { id: "u2", name: "Lee", active: false, flags: {}, getFlag: () => undefined }
  ] };
  try {
    const r = await runCommand({ name: "voicePrefs" }, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, [
      { userId: "u1", name: "Pat", active: true, voice: "thomas" },
      { userId: "u2", name: "Lee", active: false, voice: "ryan" }
    ]);
    assert.equal(readUserVoiceSlug({ flags: {} }), "ryan");
  } finally { globalThis.game = prev; }
});

test("0.8.18 scripts never reference speechSynthesis", () => {
  const root = fileURLToPath(new URL("../scripts/", import.meta.url));
  const files = [];
  const rec = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) rec(p);
      else if (name.name.endsWith(".mjs")) files.push(p);
    }
  };
  rec(root);
  assert.ok(files.length > 10);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /speechSynthesis/i, file);
  }
});

test.after(() => setImmediate(() => process.exit(0)));
