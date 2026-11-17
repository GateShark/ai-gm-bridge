// 0.9.7: Resume after "GM, wait" against fakes that match Foundry v14: AudioHelper.play with autoplay:false returns undefined,
// game.audio.play(src, {offset}) returns a Sound that plays from the offset, and a PAUSED Sound reports currentTime 0. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tick = () => new Promise(r => setImmediate(r));

const playing = new Map(); const log = []; let n = 0; let helperCalls = [];
// a v14-like Sound: currentTime is the played position while playing (offset included) and 0 while paused
function mkSound(srcName, duration, offset = 0) {
  const s = { id: `snd${++n}`, src: srcName, duration, listeners: {}, state: "playing", pos: offset, calls: [],
    get currentTime() { return this.state === "playing" ? this.pos : 0; },
    get playing() { return this.state === "playing"; },
    addEventListener(e, f) { this.listeners[e] = f; },
    pause() { this.calls.push("pause"); this.state = "paused"; },
    async play() { this.calls.push("play"); this.state = "playing"; },
    async stop() { this.calls.push("stop"); if (this.state === "playing") { this.state = "stopped"; playing.delete(this.id); } else this.state = "stopped"; /* v14: a paused sound stays in game.audio.playing */ },
    advance(sec) { if (this.state === "playing") this.pos += sec; } };
  playing.set(s.id, s); log.push(`start ${srcName}@${offset}`); return s;
}
globalThis.game = { user: { id: "p1", isGM: false }, settings: { get: () => 0.8 }, users: { contents: [] }, socket: { emit() {} },
  audio: { locked: false, playing,
    // real v14: instance play(src, options) honours options.offset and returns the Sound
    async play(srcName, options = {}) { return mkSound(srcName, 15, options.offset ?? 0); } } };
globalThis.foundry = { audio: { AudioHelper: {
  // real v14: with autoplay false it takes no further action and returns undefined
  async play(data) { helperCalls.push(data); if (data.autoplay === false) return undefined; return mkSound(data.src, 15, 0); } } },
  utils: { randomID: () => "x", escapeHTML: (s) => s } };
globalThis.ui = { notifications: { info() {} } };
const C = await import("../scripts/commands.mjs");
const Q = C.audioQueue;
const cur = () => [...playing.values()].at(-1);

test("0.9.7 #1 GM, wait at about 2.4 s, then Resume: the line continues from there (game.audio.play with an offset), is a registered Sound, and is not dropped", async () => {
  playing.clear(); log.length = 0; helperCalls = [];
  const line = Q.enqueue("t:line1", { src: "line1.mp3" }); await tick(); await tick();
  const s1 = cur(); s1.advance(2.4);
  const h = Q.hold(); assert.equal(h.stopped, true); await line; await tick();
  assert.equal(playing.size, 0, "the stopped sound left game.audio.playing");
  const r = Q.resume(); assert.equal(r.resumed, true); await tick(); await tick(); await tick();
  assert.deepEqual(log, ["start line1.mp3@0", "start line1.mp3@2.4"], "continued at 2.4 s");
  assert.equal(helperCalls.filter(d => d.autoplay === false).length, 0, "never calls AudioHelper.play with autoplay:false");
  const s2 = cur(); assert.ok(s2 && s2.state === "playing"); assert.equal(playing.size, 1);
  s2.advance(1); assert.equal(s2.currentTime, 3.4);
  s2.listeners.end?.(); await tick(); assert.equal(Q.length, 0);
});

test("0.9.7 #2 Pause, then GM, wait, then Resume continues from the paused spot (a paused Sound reports currentTime 0)", async () => {
  playing.clear(); log.length = 0;
  const line = Q.enqueue("t:line2", { src: "line2.mp3" }); await tick(); await tick();
  const s1 = cur(); s1.advance(3.1);
  assert.equal(Q.pause().paused, true); assert.equal(s1.currentTime, 0, "fake matches v14: paused reports 0"); s1.advance(10);
  assert.equal(C.currentClipPosition(), 3.1, "the position saved at Pause is used");
  Q.hold(); await line; await tick();
  assert.equal(playing.size, 0, "a paused sound that was stopped is gone from game.audio.playing");
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.deepEqual(log, ["start line2.mp3@0", "start line2.mp3@3.1"]);
  cur().listeners.end?.(); await tick();
});

test("0.9.7 #1 a second GM, wait on a line that was already continued keeps the new position", async () => {
  playing.clear(); log.length = 0;
  const line = Q.enqueue("t:line3", { src: "line3.mp3" }); await tick(); await tick();
  cur().advance(2); Q.hold(); await line; await tick();
  Q.resume(); await tick(); await tick(); await tick();
  const s2 = cur(); assert.equal(s2.currentTime, 2); s2.advance(1.5);
  Q.hold(); await tick(); await tick();
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.deepEqual(log, ["start line3.mp3@0", "start line3.mp3@2", "start line3.mp3@3.5"]);
  cur().listeners.end?.(); await tick();
});

test("0.9.7 #1 if game.audio.play is missing or gives nothing, the line plays from the start instead of being dropped; the queue never gets stuck", async () => {
  playing.clear(); log.length = 0;
  const orig = game.audio.play;
  game.audio.play = async () => undefined;
  const line = Q.enqueue("t:line4", { src: "line4.mp3" }); await tick(); await tick();
  cur().advance(1); Q.hold(); await line; await tick();
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start line4.mp3@0", "fell back to the start");
  cur().listeners.end?.(); await tick();
  delete game.audio.play;
  const l2 = Q.enqueue("t:line5", { src: "line5.mp3" }); await tick(); await tick(); cur().advance(1); Q.hold(); await l2; await tick();
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start line5.mp3@0"); cur().listeners.end?.(); await tick();
  game.audio.play = orig;
});

test("0.9.7 a normal line and Pause/Resume still work through the real clip player (no offset, autoplay true)", async () => {
  playing.clear(); log.length = 0; helperCalls = [];
  const line = Q.enqueue("t:line6", { src: "line6.mp3" }); await tick(); await tick();
  assert.equal(helperCalls.length, 1); assert.equal(helperCalls[0].autoplay, true);
  const s = cur(); s.advance(1); assert.equal(Q.pause().paused, true); assert.equal(Q.resume().resumed, true); await tick();
  assert.deepEqual(s.calls, ["pause", "play"]); s.listeners.end?.(); await line; assert.equal(Q.length, 0);
});

test("0.9.7 the code never passes autoplay:false to AudioHelper.play", () => {
  assert.doesNotMatch(src("scripts/commands.mjs"), /autoplay: !from|autoplay: false/);
  assert.match(src("scripts/commands.mjs"), /game\.audio\.play\(src, \{ volume: vol, loop: false, offset: from \}\)/);
});

test("0.9.7 version, changelog", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.9"); assert.equal(p.version, "0.9.9"); assert.equal(m.title, "AI GM Pirate Borg"); assert.equal(m.id, "ai-gm-bridge");
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.9/); assert.match(src("README.md"), /v0\.9\.9/);
  assert.match(src("docs/bot-setup-prompt.md"), /ai-gm-bridge v0\.9\.9/);
});
