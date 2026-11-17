// 0.9.5: voice buttons (Play again, Pause, Resume) on the shared audio queue, docs in the zip, wording. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { AudioQueue } from "../scripts/lib/audioqueue.mjs";
import { enhanceVoiceMessage } from "../scripts/lib/voiceui.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tick = () => new Promise(r => setImmediate(r));

// a fake clip player: each clip is a "sound" with a position that only advances while it plays
function fakeSounds() {
  const log = []; const sounds = new Map(); let current = null;
  const play = (clip) => new Promise((resolve) => {
    const s = { src: clip.src, pos: 0, playing: true, resolve, starts: 1 }; sounds.set(clip.src, s); current = s; log.push(`start ${clip.src}`);
  });
  const api = {
    log, play, get current() { return current; },
    tickAudio(ms) { if (current?.playing) current.pos += ms; },
    pauseClip() { if (!current?.playing) return false; current.playing = false; log.push(`pause ${current.src}@${current.pos}`); return true; },
    resumeClip() { if (!current || current.playing) return false; current.playing = true; log.push(`resume ${current.src}@${current.pos}`); return true; },
    stop() { if (!current) return false; log.push(`stop ${current.src}@${current.pos}`); const c = current; current = null; c.resolve(); return true; },
    finish() { const c = current; if (!c) return; log.push(`end ${c.src}@${c.pos}`); current = null; c.resolve(); }
  };
  return api;
}
const mkQueue = (fs, extra = {}) => new AudioQueue({ play: fs.play, stop: () => fs.stop(), pauseClip: () => fs.pauseClip(), resumeClip: () => fs.resumeClip(), gapMs: 0, ...extra });

test("0.9.5 #5 Pause holds the current line mid-playback and keeps the queue, turn clips included; Resume continues from the same spot, then the rest plays", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  const a = q.enqueue("voice:1", { src: "line1.mp3" }); const turn = q.enqueue("turn:c:1.1", { src: "turn.mp3", prompt: true }); const b = q.enqueue("voice:2", { src: "line2.mp3" });
  await tick(); fs.tickAudio(1500);
  const p = q.pause(); assert.equal(p.paused, true); assert.equal(q.isPaused, true);
  assert.equal(q.length, 3, "nothing dropped"); fs.tickAudio(5000); // time passes while paused: the position must not move
  assert.equal(fs.current.pos, 1500);
  const late = q.enqueue("voice:3", { src: "line3.mp3" }); await tick();
  assert.deepEqual(fs.log, ["start line1.mp3", "pause line1.mp3@1500"], "nothing else starts while paused");
  const r = q.resume(); assert.equal(r.resumed, true); assert.equal(q.isPaused, false);
  assert.equal(fs.log.at(-1), "resume line1.mp3@1500", "continues from exactly where it paused (not from the start)");
  assert.equal(fs.current.starts, 1, "the same clip, not a new one");
  fs.finish(); await tick(); await tick();
  assert.equal(fs.log.at(-1), "start turn.mp3", "then the turn clip, with no gap");
  fs.finish(); await tick(); await tick(); assert.equal(fs.log.at(-1), "start line2.mp3");
  fs.finish(); await tick(); await tick(); assert.equal(fs.log.at(-1), "start line3.mp3"); fs.finish(); await Promise.all([a, turn, b, late]);
  assert.equal(q.length, 0);
});

test("0.9.5 #5 Pause and Resume do nothing when there is nothing to pause or resume, and a double Pause is harmless", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  assert.equal(q.pause().paused, false); assert.equal(q.resume().resumed, false);
  const a = q.enqueue("v1", { src: "l1.mp3" }); await tick();
  assert.equal(q.resume().resumed, false, "not paused");
  assert.equal(q.pause().paused, true); assert.equal(q.pause().paused, false, "second Pause changes nothing");
  assert.equal(fs.log.filter(x => x.startsWith("pause")).length, 1);
  assert.equal(q.resume().resumed, true); fs.finish(); await a;
});

test("0.9.5 #5 'GM, wait' still clears everything, a paused line and the queue included", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  const a = q.enqueue("v1", { src: "l1.mp3" }); const t = q.enqueue("turn:c:1.1", { src: "t.mp3", prompt: true }); await tick(); fs.tickAudio(800);
  q.pause(); const r = q.hold(); await tick(); await tick();
  assert.equal(r.stopped, true); assert.equal(r.dropped, 1); assert.equal(q.isPaused, false); assert.equal(q.length, 0);
  assert.equal((await t).held, true); await a; assert.ok(!fs.log.some(x => x === "start t.mp3"));
  assert.equal((await q.enqueue("turn:c:1.1", { src: "t.mp3", prompt: true })).duplicate, true, "dropped turn clip does not come back");
});

test("0.9.5 #5 Play again on the line that is playing (or paused) restarts it from the beginning, then the queue carries on", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  const a = q.enqueue("v1", { src: "l1.mp3" }); const t = q.enqueue("turn:c:1.1", { src: "t.mp3", prompt: true }); await tick(); fs.tickAudio(2000);
  const again = q.playLine({ src: "l1.mp3" }); await tick(); await tick();
  assert.deepEqual(fs.log.slice(0, 3), ["start l1.mp3", "stop l1.mp3@2000", "start l1.mp3"], "restarted at once (no gap)");
  assert.equal(fs.current.pos, 0, "from the start");
  // paused, then Play: restarts from the start and is no longer paused
  q.pause(); assert.equal(q.isPaused, true); fs.tickAudio(0);
  const again2 = q.playLine({ src: "l1.mp3" }); await tick(); await tick();
  assert.equal(q.isPaused, false); assert.equal(fs.current.pos, 0); assert.equal(fs.current.playing, true);
  fs.finish(); await tick(); await tick(); assert.equal(fs.log.at(-1), "start t.mp3", "the queue (turn clip) still follows");
  fs.finish(); await Promise.all([a, t, again, again2]);
  // a line that is not playing is queued behind (once); one already waiting is left alone
  const fs2 = fakeSounds(), q2 = mkQueue(fs2); const x = q2.enqueue("x", { src: "x.mp3" }); await tick();
  const first = q2.playLine({ src: "y.mp3" }); const dup = await q2.playLine({ src: "y.mp3" });
  assert.equal(dup.already, true); assert.equal(fs2.log.length, 1, "y waits behind x"); fs2.finish(); await tick(); await tick(); assert.equal(fs2.log.at(-1), "start y.mp3"); fs2.finish(); await Promise.all([x, first]);
});

test("0.9.5 #5 the buttons: Play is never greyed out, Pause and Resume sit next to ▶ and 'GM, wait', bots get none", () => {
  const mkEl = (tag) => { const el = { tag, className: "", dataset: {}, listeners: {}, children: [], attrs: {}, textContent: "", title: "", hidden: false, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute() {}, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener(e, f) { this.listeners[e] = f; },
    insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; },
    get nextSibling() { const i = this.parentNode?.children.indexOf(this) ?? -1; return this.parentNode?.children[i + 1] ?? null; }, childNodes: [], click() { this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }); } }; return el; };
  const build = (opts) => {
    const doc = { createElement: mkEl }; const row = mkEl("div"); const audio = mkEl("audio"); audio.attrs.src = "a.mp3"; row.children.push(audio); audio.parentNode = row;
    row.querySelector = (sel) => sel.startsWith("audio") ? audio : (sel === "[data-aigm-replay]" ? null : null); row.ownerDocument = doc; row.childNodes = [];
    const ok = enhanceVoiceMessage({ id: "m1", content: "Hello there" }, row, { ...opts });
    return { ok, row, audio, names: row.children.map(c => c.className || c.tag) };
  };
  const calls = []; const o = { playLine: (s) => calls.push(["play", s]), pause: () => calls.push(["pause"]), resume: () => calls.push(["resume"]), hold: () => calls.push(["hold"]) };
  const { ok, row, names } = build(o); assert.equal(ok, true);
  assert.deepEqual(names, ["aigm-voice-replay", "aigm-voice-hold aigm-voice-pause", "aigm-voice-hold aigm-voice-resume", "aigm-voice-hold", "audio"]);
  const [play, pause, resume, hold] = row.children; play.click(); play.click(); pause.click(); resume.click();
  assert.equal(play.disabled, undefined, "never disabled"); assert.deepEqual(calls.map(c => c[0]), ["play", "play", "pause", "resume"]);
  assert.equal(pause.textContent, "Pause"); assert.equal(resume.textContent, "Resume");
  const bot = build({ playLine: o.playLine, pause: null, resume: null, hold: null }); assert.deepEqual(bot.names, ["aigm-voice-replay", "audio"]);
  // without playLine the old greyed-out replay is unchanged
  const old = build({ replay: () => new Promise(() => {}) }); old.row.children[0].click(); assert.equal(old.row.children[0].disabled, true);
});

test("0.9.5 #5 recorded voices only: the wiring uses the shared queue and no browser speech anywhere", () => {
  const main = src("scripts/main.mjs");
  assert.match(main, /playLine: \(src, meta\) => audioQueue\.playLine/); assert.match(main, /pause: isBot\(\) \? null : \(\) => audioQueue\.pause\(\)/); assert.match(main, /resume: isBot\(\) \? null : \(\) => audioQueue\.resume\(\)/);
  const cmds = src("scripts/commands.mjs");
  assert.match(cmds, /pauseClip: \(\) => pauseCurrentClip\(\), resumeClip: \(\) => resumeCurrentClip\(\)/);
  assert.match(cmds, /c\.sound\.pause\(\)/); assert.match(cmds, /c\.sound\.play\(\)/);
  for (const f of ["scripts/main.mjs", "scripts/commands.mjs", "scripts/lib/audioqueue.mjs", "scripts/lib/voiceui.mjs"]) assert.doesNotMatch(src(f), /speechSynthesis|SpeechSynthesisUtterance/, f);
  const { DEFAULT_TTS_VOICE } = awaitedVoices; assert.equal(DEFAULT_TTS_VOICE, "en-GB-RyanNeural");
  const lang = JSON.parse(src("lang/en.json")); assert.equal(lang.AIGM.voice.pause, "Pause"); assert.equal(lang.AIGM.voice.resume, "Resume"); assert.equal(lang.AIGM.voice.hold, "GM, wait");
});
const awaitedVoices = await import("../scripts/lib/voices.mjs");

test("0.9.5 #5 the real clip player: pause keeps the position and the end-timer off, resume continues the same sound, a pause-caused 'end' does not finish it", async () => {
  const sounds = [];
  const mkSound = (duration) => { const s = { duration, currentTime: 0, listeners: {}, calls: [], playing: true,
    addEventListener(e, f) { this.listeners[e] = f; }, pause() { this.calls.push("pause"); this.playing = false; this.listeners.end?.(); }, // some builds fire "end" when paused
    async play() { this.calls.push("play"); this.playing = true; }, async stop() { this.calls.push("stop"); this.playing = false; } }; sounds.push(s); return s; };
  globalThis.game = { user: { id: "p1", isGM: false }, audio: { locked: false }, settings: { get: () => 0.8 }, users: { contents: [] }, socket: { emit() {} } };
  globalThis.foundry = { audio: { AudioHelper: { play: async () => mkSound(0.2) } }, utils: { randomID: () => "x", escapeHTML: (s) => s } };
  globalThis.ui = { notifications: { info() {} } };
  const C = await import("../scripts/commands.mjs");
  const done = []; const p1 = C.audioQueue.enqueue("t:a", { src: "a.mp3" }).then(() => done.push("a")); const p2 = C.audioQueue.enqueue("t:b", { src: "b.mp3", prompt: true }).then(() => done.push("b"));
  await tick(); await tick(); const s1 = sounds[0]; assert.ok(s1);
  s1.currentTime = 0.05; assert.equal(C.audioQueue.pause().paused, true); assert.deepEqual(s1.calls, ["pause"]);
  await new Promise(r => setTimeout(r, 900)); // longer than the clip's own end-timer: it must not finish while paused
  assert.deepEqual(done, [], "still paused, nothing finished, the queued turn clip waits"); assert.equal(sounds.length, 1);
  assert.equal(C.audioQueue.resume().resumed, true); await tick(); assert.deepEqual(s1.calls, ["pause", "play"], "play() with no offset continues from the paused time");
  s1.listeners.end?.(); await p1; assert.deepEqual(done, ["a"]);
  await tick(); await tick(); assert.equal(sounds.length, 2, "the queued turn clip plays after the resumed line");
  sounds[1].listeners.end?.(); await p2; assert.deepEqual(done, ["a", "b"]);
  // GM, wait while paused: stops the paused sound and the queue is clear
  const p3 = C.audioQueue.enqueue("t:c", { src: "c.mp3" }); const p4 = C.audioQueue.enqueue("t:d", { src: "d.mp3" }); await tick(); await tick();
  C.audioQueue.pause(); const h = C.audioQueue.hold(); await tick(); await tick(); await p3; assert.equal(h.stopped, true); assert.ok(sounds[2].calls.includes("stop")); assert.equal((await p4).held, true); assert.equal(C.audioQueue.isPaused, false);
});

// ---------- docs in the zip, wording, metadata ----------
import { packageFiles } from "../tools/package-files.mjs";
test("0.9.5 #2 BOT-API.md is in the zip, and every file the in-game docs point at is in the zip", () => {
  const zip = new Set(packageFiles());
  for (const f of ["docs/BOT-API.md", "docs/SETUP.md", "docs/bot-setup-prompt.md", "module.json", "README.md", "CHANGELOG.md", "relay/RUN.md", "examples/echo-gm.mjs", "scripts/lib/localnet.mjs", "scripts/lib/botwake.mjs"]) assert.ok(zip.has(f), `${f} must be in the zip`);
  for (const f of zip) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} listed but missing`);
  // every repo-relative file the shown docs name (in backticks or markdown links) is shipped
  const refs = new Set();
  for (const d of ["docs/SETUP.md", "docs/bot-setup-prompt.md", "README.md"]) {
    const s = src(d);
    for (const m of s.matchAll(/`((?:docs|relay|examples|scripts|lang|assets)\/[\w./-]+\.(?:md|mjs|json|mp3))`/g)) refs.add(m[1]);
    for (const m of s.matchAll(/\]\((?!https?:|#|mailto:)([\w./-]+\.(?:md|mjs|json))\)/g)) refs.add(m[1].replace(/^\.\//, ""));
    for (const m of s.matchAll(/`(README\.md|CHANGELOG\.md|LICENSE)`/g)) refs.add(m[1]);
  }
  assert.ok(refs.has("docs/BOT-API.md") && refs.has("relay/RUN.md"), "the scan sees the real links");
  for (const r of refs) { if (/^(docs|relay|examples|scripts|lang|assets)\//.test(r) && /\*|<|>/.test(r)) continue; if (/^docs\/setup-prompt|up-<|voice-<|turn-<|up-/.test(r)) continue; assert.ok(zip.has(r) || /^(scripts|assets)\//.test(r) && [...zip].some(z => z === r), `${r} is named by the docs but not in the zip`); }
  // the files the add-on itself loads or links
  const prompt = src("scripts/lib/setupprompt.mjs"); assert.match(prompt, /PROMPT_FILE = "docs\/bot-setup-prompt\.md"/); assert.ok(zip.has("docs/bot-setup-prompt.md"));
  assert.match(src("scripts/main.mjs"), /blob\/main\/docs\/SETUP\.md/);
});

test("0.9.5 #3/#4 docs: plain chat never wakes the bot; the class-item errors come from the game system", () => {
  const setup = src("docs/SETUP.md"), api = src("docs/BOT-API.md");
  assert.match(setup, /Plain chat does not wake the bot/); assert.match(setup, /speaker\.actor/); assert.match(setup, /never wakes the bot/);
  assert.match(api, /A plain line with none of those never wakes the bot/); assert.match(api, /speaker\.actor/);
  for (const d of [setup, api, src("CHANGELOG.md")]) assert.match(d, /come from the game system, not (from )?(this|the) add-on/);
});

test("0.9.5 #3 the filter behaves as the docs say: a plain line with no mention, question, keyword or actor never wakes the bot", async () => {
  const { classify } = await import("../scripts/lib/filter.mjs");
  const o = { keywords: ["door"], gmNames: ["gm", "ai gm"] };
  assert.equal(classify({ text: "ok sounds good", author: "Pat", authorId: "u1" }, o).wake, false);
  assert.equal(classify({ text: "ok sounds good", inCharacter: true, authorId: "u1" }, o).reason, "ic");
  assert.equal(classify({ text: "is there a lock?", authorId: "u1" }, o).reason, "question");
  assert.equal(classify({ text: "GM, we open it", authorId: "u1" }, o).reason, "mention");
  assert.equal(classify({ text: "I check the door", authorId: "u1" }, o).reason, "keyword");
});

test("0.9.5 manifest, package, changelog, README, setup prompt", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.5"); assert.equal(p.version, "0.9.5"); assert.equal(m.id, "ai-gm-bridge"); assert.equal(m.title, "AI GM Pirate Borg");
  assert.match(m.manifest, /\/releases\/latest\/download\/module\.json$/); assert.match(m.download, /\/releases\/latest\/download\/module\.zip$/);
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.5/); assert.match(src("README.md"), /v0\.9\.5/);
  assert.match(src("docs/bot-setup-prompt.md"), /ai-gm-bridge v0\.9\.5/); assert.doesNotMatch(src("docs/bot-setup-prompt.md"), /v0\.9\.4/);
  assert.match(src("docs/SETUP.md"), /Pause, Resume/); assert.match(src("docs/BOT-API.md"), /## v0\.9\.5/);
  assert.doesNotMatch(src("docs/SETUP.md") + src("docs/BOT-API.md") + src("docs/bot-setup-prompt.md"), /Kevin|Allen|\bKev\b|@gmail\.com/);
});
