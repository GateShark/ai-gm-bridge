// 0.9.9: Play always starts at 0 (never the old Resume offset), the badge keeps "reply N s" across a leader restart (world setting
// gmPing), and every add-on DOM query is null-safe (the "null querySelectorAll" errors). Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tick = () => new Promise(r => setImmediate(r));

// ---------- fakes that match Foundry v14 (as in 0.9.7): a paused Sound reports currentTime 0; game.audio.play honours offset ----------
const playing = new Map(); const log = []; let n = 0;
function mkSound(srcName, duration, offset = 0) {
  const s = { id: `snd${++n}`, src: srcName, duration, listeners: {}, state: "playing", pos: offset,
    get currentTime() { return this.state === "playing" ? this.pos : 0; },
    addEventListener(e, f) { this.listeners[e] = f; },
    pause() { this.state = "paused"; }, async play() { this.state = "playing"; },
    async stop() { if (this.state === "playing") { this.state = "stopped"; playing.delete(this.id); } else this.state = "stopped"; },
    advance(sec) { if (this.state === "playing") this.pos += sec; } };
  playing.set(s.id, s); log.push(`start ${srcName}@${offset}`); return s;
}
globalThis.game = { user: { id: "p1", isGM: false }, settings: { get: () => 0.8 }, users: { contents: [] }, socket: { emit() {} },
  audio: { locked: false, playing, async play(srcName, options = {}) { return mkSound(srcName, 20, options.offset ?? 0); } } };
globalThis.foundry = { audio: { AudioHelper: { async play(data) { return mkSound(data.src, 20, 0); } } }, utils: { randomID: () => "x", escapeHTML: (s) => s },
  applications: { api: { ApplicationV2: class { } } } };
globalThis.ui = { notifications: { info() {} } };
const C = await import("../scripts/commands.mjs");
const { AudioQueue, fromStart } = await import("../scripts/lib/audioqueue.mjs");
const Q = C.audioQueue;
const cur = () => [...playing.values()].at(-1);
const reset = () => { playing.clear(); log.length = 0; };

// ================= 1. Play after Resume starts at 0 =================
test("0.9.9 #1 Play, GM wait at ~4 s, Resume, then Play again: the line restarts at 0, not at the old resume offset", async () => {
  reset();
  const line = Q.enqueue("t:p1", { src: "p1.mp3" }); await tick(); await tick();
  cur().advance(4);
  Q.hold(); await line; await tick();
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start p1.mp3@4", "Resume still continues at the held spot");
  cur().advance(0.3);
  const again = Q.playLine({ src: "p1.mp3" }); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start p1.mp3@0", "Play restarts at 0");
  assert.deepEqual(log, ["start p1.mp3@0", "start p1.mp3@4", "start p1.mp3@0"]);
  cur().listeners.end?.(); await again; await tick(); assert.equal(Q.length, 0);
});

test("0.9.9 #1 repeated Play after Resume keeps starting at 0; a second GM wait + Resume still uses the new offset", async () => {
  reset();
  const line = Q.enqueue("t:p2", { src: "p2.mp3" }); await tick(); await tick();
  cur().advance(3.85); Q.hold(); await line; await tick();
  Q.resume(); await tick(); await tick(); await tick();
  for (let i = 0; i < 3; i++) { cur().advance(1.2); Q.playLine({ src: "p2.mp3" }); await tick(); await tick(); await tick(); assert.equal(log.at(-1), "start p2.mp3@0", `Play #${i + 1} starts at 0`); }
  cur().advance(2); Q.hold(); await tick(); await tick(); await tick();
  assert.equal(Q.resume().resumed, true); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start p2.mp3@2", "Resume uses the offset from the latest GM wait");
  cur().listeners.end?.(); await tick();
});

test("0.9.9 #1 Pause, Resume, Play: starts at 0 (the same path as GM wait, Resume, Play)", async () => {
  reset();
  const line = Q.enqueue("t:p3", { src: "p3.mp3" }); await tick(); await tick();
  cur().advance(4); assert.equal(Q.pause().paused, true); assert.equal(Q.resume().resumed, true);
  cur().advance(1);
  Q.playLine({ src: "p3.mp3" }); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start p3.mp3@0");
  cur().listeners.end?.(); await tick();
});

test("0.9.9 #1 GM wait, then Play (no Resume) starts at 0, and a Resume after that plays nothing old", async () => {
  reset();
  const line = Q.enqueue("t:p4", { src: "p4.mp3" }); await tick(); await tick();
  cur().advance(5); Q.hold(); await line; await tick();
  const p = Q.playLine({ src: "p4.mp3" }); await tick(); await tick(); await tick();
  assert.equal(log.at(-1), "start p4.mp3@0");
  assert.equal(Q.resume().fromHold ?? false, false, "the held offset was cleared by Play: nothing left to resume");
  cur().listeners.end?.(); await p; await tick();
});

test("0.9.9 #1 when a line ends on its own the held offset is gone; a stale Resume does nothing", async () => {
  reset();
  const line = Q.enqueue("t:p5", { src: "p5.mp3" }); await tick(); await tick();
  cur().advance(2); Q.hold(); await line; await tick();
  Q.resume(); await tick(); await tick(); await tick();
  cur().listeners.end?.(); await tick(); await tick();           // the continued line ends by itself
  assert.equal(Q.heldClip, null);
  assert.equal(Q.resume().resumed, false);
  assert.equal(log.length, 2, "nothing played again");
});

test("0.9.9 #1 pure queue: restartCurrent and replay strip any offset; a resumed clip with position 0 has no offset; fromStart leaves other fields alone", async () => {
  assert.deepEqual(fromStart({ src: "a", text: "t", offset: 4.2 }), { src: "a", text: "t" });
  assert.deepEqual(fromStart({ src: "a" }), { src: "a" }); assert.equal(fromStart(null), null);
  const played = []; const q = new AudioQueue({ play: async (c) => { played.push({ ...c }); await new Promise(r => q.finish = r); }, stop: () => { q.finish?.(); return true; }, position: () => 0, sleep: async () => {} });
  const l = q.enqueue("x", { src: "x.mp3" }); await tick();
  q.hold(); await l; await tick();
  q.resume(); await tick(); await tick();
  assert.equal("offset" in played.at(-1), false, "position 0 resumes without an offset");
  const r = q.restartCurrent(); await tick(); await tick(); await tick();
  assert.equal("offset" in played.at(-1), false);
  q.finish?.(); await r;
  const w = q.replay({ src: "x.mp3", offset: 9 }); await tick(); assert.equal("offset" in played.at(-1), false, "replay never carries an offset"); q.finish?.(); await w;
});

test("0.9.9 #1 Resume still passes the offset to the clip player (offset is only for Resume)", () => {
  const a = src("scripts/lib/audioqueue.mjs");
  assert.match(a, /\.\.\.\(h\.pos > 0 \? \{ offset: h\.pos \} : \{\}\)/);
  assert.match(a, /clip: fromStart\(cur\.clip\)/);
});

// ================= 2. reply time survives a restart of the leader's session =================
import { ReplyTimes, buildSnapshot, createPublisher, storedReplies, rowText, GMPING_KEEP, GMPING_PUBLISH_MS } from "../scripts/lib/gmping.mjs";

test("0.9.9 #2 a new leader seeds its reply times from the published gmPing and keeps them in the next snapshot", () => {
  const published = buildSnapshot({ seenAt: 5000, replies: [8000, 12000, 18000] });
  const fresh = new ReplyTimes();                                   // the restarted session: empty memory
  assert.equal(buildSnapshot({ replies: fresh.list() }).replies.length, 0, "without the fix the next publish would be empty");
  assert.equal(fresh.seed(storedReplies(published)), true);
  const snap = buildSnapshot({ seenAt: 9000, replies: fresh.list() });
  assert.deepEqual(snap.replies, [8000, 12000, 18000]);
  assert.match(rowText({ snap, state: "listening", seenAt: 9000, now: 10000 }), /reply 18 s/);
});

test("0.9.9 #2 seeding happens once, keeps order, caps at the keep limit, ignores junk, and new replies go after the stored ones", () => {
  const r = new ReplyTimes();
  assert.equal(r.seed([1000, "x", null, -5, NaN, 2000, 3000, 4000, 5000, 6000, 7000]), true);
  assert.deepEqual(r.list(), [3000, 4000, 5000, 6000, 7000]); assert.equal(r.list().length, GMPING_KEEP);
  assert.equal(r.seed([99999]), false, "only once"); assert.deepEqual(r.list(), [3000, 4000, 5000, 6000, 7000]);
  r.openBatch([{ type: "chat", at: 0 }], 0); r.reply(9000); assert.equal(r.last, 9000); assert.deepEqual(r.list(), [4000, 5000, 6000, 7000, 9000]);
  const e = new ReplyTimes(); assert.equal(e.seed(undefined), false); assert.equal(e.seed([5]), false, "an empty seed still counts as done"); assert.deepEqual(e.list(), []);
  assert.deepEqual(storedReplies(null), []); assert.deepEqual(storedReplies({ replies: "no" }), []);
});

test("0.9.9 #2 the restart does not write more often than once per 5 s and writes the kept replies in the first snapshot", () => {
  let t = 100000; const writes = []; const timers = [];
  const pub = createPublisher({ write: (s) => writes.push(s), now: () => t, setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; } });
  const rt = new ReplyTimes(); rt.seed([8000, 18000]);
  assert.equal(pub.push(buildSnapshot({ seenAt: 1, replies: rt.list() })), true); assert.deepEqual(writes[0].replies, [8000, 18000]);
  t += 1000; pub.push(buildSnapshot({ seenAt: 2, replies: rt.list() })); t += 1000; pub.push(buildSnapshot({ seenAt: 3, replies: rt.list() }));
  assert.equal(writes.length, 1, "throttled"); assert.ok(timers[0].ms <= GMPING_PUBLISH_MS);
  t += 4000; timers[0].f(); assert.equal(writes.length, 2); assert.deepEqual(writes[1].replies, [8000, 18000]);
});

test("0.9.9 #2 main.mjs seeds the leader once from the gmPing setting, only the leader measures, and the 5 s publisher is unchanged", () => {
  const m = src("scripts/main.mjs");
  const ps = m.slice(m.indexOf("function pingSnapshot("), m.indexOf("// the leader (a GM) measures and shares"));
  assert.match(ps, /S\.replyTimes\.seeded/); assert.match(ps, /storedReplies\(get\("gmPing"\)\)/);
  assert.match(m, /createPublisher\(\{ write:/); assert.match(src("scripts/lib/gmping.mjs"), /GMPING_PUBLISH_MS = 5000/);
  assert.match(m, /const snap = \(amLeader\(\) && S\.outbox\) \? pingSnapshot\(now\) : \(get\("gmPing"\) \?\? \{\}\)/);
});

// ================= 3. null-safe DOM =================
import { rootOf, qs, qsa } from "../scripts/lib/dom.mjs";
import { injectLuckTracker } from "../scripts/lib/devilsluck.mjs";
import { enhanceVoiceMessage } from "../scripts/lib/voiceui.mjs";
import { attachCaptionFontPreview } from "../scripts/lib/captions.mjs";
import { makeGmPanel, installSidebarButton } from "../scripts/lib/gmpanel.mjs";
import { GmPingBadge } from "../scripts/lib/gmping.mjs";

const el = (extra = {}) => ({ querySelector: () => null, querySelectorAll: () => [], ...extra });

test("0.9.9 #3 rootOf: an Element, a jQuery-like object, nothing, or junk; a <form> is never read as html[0]", () => {
  const e = el(); assert.equal(rootOf(e), e);
  const first = el(); assert.equal(rootOf({ 0: first, length: 1 }), first, "jQuery-like");
  assert.equal(rootOf({ get: (i) => (i === 0 ? first : null) }), first);
  for (const bad of [null, undefined, 0, "", {}, [], { 0: null }, { 0: {} }, "text", 42]) assert.equal(rootOf(bad), null);
  const field = { /* an <input>: no querySelector */ }; const form = el({ 0: field, length: 1 });
  assert.equal(rootOf(form), form, "the form itself, not its first field");
  assert.equal(qs(null, "x"), null); assert.deepEqual(qsa(undefined, "x"), []);
  assert.deepEqual(qsa({ querySelectorAll: () => { throw new Error("boom"); }, querySelector() {} }, "x"), [], "never throws");
  assert.deepEqual(qsa(el({ querySelectorAll: () => ["a", "b"] }), "x"), ["a", "b"]);
});

test("0.9.9 #3 caption font preview in Configure Settings attaches to the settings <form> (v14 passes the form, whose html[0] is its first field)", () => {
  const made = []; const doc = { createElement: () => { const d = { dataset: {}, style: {}, className: "" }; made.push(d); return d; } };
  const select = { value: "", parentNode: { querySelector: () => null, appendChild(x) { this.child = x; } }, addEventListener() {} };
  const firstField = {};                                              // like a form's html[0]: an <input> with no querySelector
  const form = { 0: firstField, ownerDocument: doc, querySelector: () => select, querySelectorAll: () => [] };
  assert.ok(attachCaptionFontPreview(form), "preview attached to the form");
  assert.equal(attachCaptionFontPreview(firstField), null, "the old html[0] path found nothing and silently did nothing");
  assert.equal(attachCaptionFontPreview(null), null); assert.equal(attachCaptionFontPreview(undefined), null); assert.equal(attachCaptionFontPreview({}), null);
  const m = src("scripts/main.mjs");
  assert.match(m, /Hooks\.on\("renderSettingsConfig", \(_app, html\) => \{ try \{ fillCaptionFontChoices\(\); const root = rootOf\(html\); if \(root\) attachCaptionFontPreview\(root\)/);
});

test("0.9.9 #3 render hooks and panels do nothing (and never throw) when the element is missing", async () => {
  assert.equal(injectLuckTracker(null, { actor: { type: "character", system: { attributes: { luck: { value: 3 } } } } }), null);
  assert.equal(injectLuckTracker(undefined, { actor: { type: "character", id: "a" } }), null);
  assert.equal(injectLuckTracker({ 0: null }, { actor: { type: "character", id: "a" } }), null);
  assert.equal(enhanceVoiceMessage({ id: "m" }, null, { replay() {} }), false);
  assert.equal(enhanceVoiceMessage({ id: "m" }, undefined, { replay() {} }), false);
  assert.equal(enhanceVoiceMessage({ id: "m" }, { 0: null }, { replay() {} }), false);
  assert.equal(enhanceVoiceMessage({ id: "m" }, el(), { replay() {} }), false);
  // GM panel and the two settings forms: _replaceHTML with no content element
  const Panel = makeGmPanel({ gather: () => ({}), onAction: async () => {} });
  const p = new Panel(); assert.doesNotThrow(() => p._replaceHTML("<p/>", null)); assert.doesNotThrow(() => p._replaceHTML("<p/>", undefined)); assert.doesNotThrow(() => p._replaceHTML("<p/>", {}));
  // the panel still binds when there is an element
  const btn = { dataset: { aigmAction: "recap" }, addEventListener(ev, f) { this.f = f; } };
  const content = { innerHTML: "", querySelectorAll: () => [btn], querySelector: () => null };
  let seen = null; const P2 = makeGmPanel({ gather: () => ({}), onAction: async (a, o) => { seen = { a, o }; return null; } }); const p2 = new P2(); p2.render = () => {};
  p2._replaceHTML("<x/>", content); assert.equal(content.innerHTML, "<x/>"); await btn.f({ preventDefault() {} }); assert.equal(seen.a, "recap"); assert.equal(seen.o.tableId, "");
  for (const f of ["scripts/config-app.mjs", "scripts/setup-prompt-app.mjs"]) assert.match(src(f), /_replaceHTML\(html, content\) \{\n\s+if \(!content \|\| typeof content\.querySelector !== "function"\) return;/, f);
});

test("0.9.9 #3 the Players-list hook and the badge never throw when #players or layout is missing (v14 renderPlayers)", () => {
  const body = { appendChild() {} };
  const made = () => { const o = { dataset: {}, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, remove() {}, get offsetWidth() { throw new Error("layout not ready"); } }; return o; };
  const doc = { body, getElementById: () => null, createElement: made, addEventListener() {} };
  const b = new GmPingBadge({ doc, win: { innerWidth: 1000, innerHeight: 700 }, playersRect: () => { throw new Error("no #players"); } });
  assert.doesNotThrow(() => b.mount()); assert.doesNotThrow(() => b.place()); assert.doesNotThrow(() => b.place(true));
  const bare = new GmPingBadge({ doc: { body: null } }); assert.equal(bare.mount(), null); assert.equal(bare.place(), null);
  assert.equal(installSidebarButton({ doc: { getElementById: () => null, querySelector: () => null, createElement: () => ({ dataset: {}, style: {}, addEventListener() {}, setAttribute() {} }), body: null } }), false);
  const m = src("scripts/main.mjs");
  assert.match(m, /Hooks\.on\("renderPlayers", \(\) => \{ try \{ pingBadge\?\.place\(\); \} catch \{\} \}\)/);
  assert.match(m, /document\.getElementById\("players"\)\?\.getBoundingClientRect\?\.\(\)/);
});

test("0.9.9 #3 no add-on file calls querySelector/querySelectorAll on a value that can be null without a guard", () => {
  // every add-on DOM query is optional-chained, runs on an element the add-on just created, or follows an explicit guard
  const files = ["scripts/main.mjs", "scripts/features.mjs", "scripts/commands.mjs", "scripts/config-app.mjs", "scripts/setup-prompt-app.mjs", "scripts/ship.mjs",
    ...["audioqueue", "captions", "devilsluck", "gmpanel", "gmping", "gmstatus", "ptt", "setupprompt", "thinking", "voiceui", "styles", "dom"].map(f => `scripts/lib/${f}.mjs`)];
  const bad = [];
  for (const f of files) src(f).split("\n").forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const m of line.matchAll(/(html\??\.\[0\]|\bhtml)\??\.querySelector(All)?\(/g)) bad.push(`${f}:${i + 1} ${m[0]}`);
    if (/\bhtml\?\.\[0\] \?\? html/.test(line)) bad.push(`${f}:${i + 1} html?.[0] ?? html`);
  });
  assert.deepEqual(bad, []);
  // the one unguarded receiver that used to exist: the panel's content element
  assert.doesNotMatch(src("scripts/lib/gmpanel.mjs"), /\n\s+content\.querySelectorAll\(/);
});

// ================= version, changelog, docs =================
test("0.9.9 version, changelog, README, setup prompt header", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.9"); assert.equal(p.version, "0.9.9"); assert.equal(m.title, "AI GM Pirate Borg"); assert.equal(m.id, "ai-gm-bridge");
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.9/); assert.match(src("README.md"), /v0\.9\.9/);
  assert.match(src("docs/bot-setup-prompt.md"), /ai-gm-bridge v0\.9\.9/);
  const c = src("CHANGELOG.md").split("## 0.9.8")[0];
  assert.match(c, /Play/); assert.match(c, /gmPing/); assert.match(c, /querySelectorAll/); assert.match(c, /Gate \(GateShark\)/);
  assert.doesNotMatch(c, /Kevin|Allen|192\.168|\/mnt\/|\/home\//);
});
