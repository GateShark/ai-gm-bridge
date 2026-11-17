// 0.9.6: Resume after "GM, wait", fast moraleCheck, setup guide link, stopped sounds leave game.audio.playing. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AudioQueue } from "../scripts/lib/audioqueue.mjs";
import { SETUP_GUIDE_URL, guideHref, openSetupGuide } from "../scripts/lib/setupprompt.mjs";
import { packageFiles } from "../tools/package-files.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tick = () => new Promise(r => setImmediate(r));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// a fake clip player with positions and offsets
function fakeSounds() {
  const log = []; let current = null;
  const play = (clip) => new Promise((resolve) => { const s = { src: clip.src, pos: clip.offset ?? 0, playing: true, resolve }; current = s; log.push(`start ${clip.src}@${s.pos}`); });
  return {
    log, play, get current() { return current; },
    tickAudio(ms) { if (current?.playing) current.pos += ms; },
    position: () => current ? current.pos : null,
    pauseClip() { if (!current?.playing) return false; current.playing = false; log.push(`pause@${current.pos}`); return true; },
    resumeClip() { if (!current || current.playing) return false; current.playing = true; log.push(`resume@${current.pos}`); return true; },
    stop() { if (!current) return false; log.push(`stop@${current.pos}`); const c = current; current = null; c.resolve(); return true; },
    finish() { const c = current; if (!c) return; log.push(`end ${c.src}`); current = null; c.resolve(); }
  };
}
const mkQueue = (fs) => new AudioQueue({ play: fs.play, stop: () => fs.stop(), position: () => fs.position(), pauseClip: () => fs.pauseClip(), resumeClip: () => fs.resumeClip(), gapMs: 0 });

// ---------- 1. Resume after "GM, wait" ----------
test("0.9.6 #1 Resume after GM, wait continues the stopped line from where it stopped; the queue behind it stays cleared", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  const a = q.enqueue("v1", { src: "l1.mp3", text: "x" }); const t = q.enqueue("turn:c:1", { src: "t.mp3", prompt: true }); const b = q.enqueue("v2", { src: "l2.mp3" });
  await tick(); fs.tickAudio(2300);
  const h = q.hold(); assert.equal(h.stopped, true); assert.equal(h.dropped, 2);
  await Promise.all([a, t, b]); await tick();
  const r = q.resume(); assert.equal(r.resumed, true); assert.equal(r.fromHold, true);
  await tick();
  assert.equal(fs.log.at(-1), "start l1.mp3@2300", "same line, continued from 2.3 s (not the start)");
  fs.finish(); await tick(); await tick();
  assert.equal(fs.log.filter(x => x.startsWith("start")).length, 2, "the dropped line and turn clip never come back");
  assert.equal(q.length, 0); assert.equal(q.resume().resumed, false, "nothing left to resume");
});

test("0.9.6 #1 Resume after Pause then GM, wait continues from the paused spot", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  q.enqueue("v1", { src: "l1.mp3" }); await tick(); fs.tickAudio(1200); q.pause(); fs.tickAudio(5000);
  q.hold(); await tick();
  assert.equal(q.resume().resumed, true); await tick();
  assert.equal(fs.log.at(-1), "start l1.mp3@1200"); fs.finish();
});

test("0.9.6 #1 Play still restarts the held line from the start, and then Resume has nothing to continue", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  q.enqueue("v1", { src: "l1.mp3" }); await tick(); fs.tickAudio(900); q.hold(); await tick();
  q.playLine({ src: "l1.mp3" }); await tick();
  assert.equal(fs.log.at(-1), "start l1.mp3@0", "Play = from the beginning");
  assert.equal(q.resume().resumed, false, "a new line started: the old stop point is gone");
  fs.finish();
});

test("0.9.6 #1 once a new line starts, the held one cannot be resumed; Resume with nothing held is harmless", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  assert.equal(q.resume().resumed, false);
  q.enqueue("v1", { src: "l1.mp3" }); await tick(); fs.tickAudio(500); q.hold(); await tick();
  const n = q.enqueue("v9", { src: "new.mp3" }); await tick();
  assert.equal(fs.log.at(-1), "start new.mp3@0");
  assert.equal(q.resume().resumed, false, "the new line is playing; nothing to continue");
  assert.equal(fs.log.filter(x => x.startsWith("start l1")).length, 1);
  fs.finish(); await n;
  assert.equal(q.resume().resumed, false);
});

test("0.9.6 #1 GM, wait with nothing playing keeps no stale stop point; a second GM, wait keeps the first", async () => {
  const fs = fakeSounds(), q = mkQueue(fs);
  q.hold(); assert.equal(q.resume().resumed, false);
  q.enqueue("v1", { src: "l1.mp3" }); await tick(); fs.tickAudio(700); q.hold(); q.hold(); await tick();
  assert.equal(q.resume().resumed, true); await tick(); assert.equal(fs.log.at(-1), "start l1.mp3@700"); fs.finish();
});

test("0.9.6 #1 wiring: the queue gets the clip position, and the player skips to the offset (autoplay off, then play with offset)", () => {
  const cmds = src("scripts/commands.mjs");
  assert.match(cmds, /position: \(\) => currentClipPosition\(\)/);
  assert.match(cmds, /autoplay: !from/); assert.match(cmds, /sound\.play\(\{ offset: from/);
});

// ---------- 2. setup guide link ----------
test("0.9.6 #2 the setup guide link points at the file bundled in the module (no GitHub main address) and opens as plain text", async () => {
  assert.equal(SETUP_GUIDE_URL, "modules/ai-gm-bridge/docs/SETUP.md");
  assert.ok(packageFiles().includes("docs/SETUP.md"), "the file is in the zip");
  assert.equal(guideHref(() => "/foundry/modules/ai-gm-bridge/docs/SETUP.md"), "/foundry/modules/ai-gm-bridge/docs/SETUP.md");
  assert.equal(guideHref(), "/modules/ai-gm-bridge/docs/SETUP.md");
  for (const f of ["scripts/config-app.mjs", "scripts/setup-prompt-app.mjs", "scripts/main.mjs", "scripts/lib/setupprompt.mjs"]) assert.doesNotMatch(src(f), /blob\/main/, f);
  assert.match(src("scripts/config-app.mjs"), /data-aigm-guide/); assert.match(src("scripts/setup-prompt-app.mjs"), /data-aigm-guide/);
  const opened = []; let prevented = false;
  const ok = await openSetupGuide({ preventDefault: () => { prevented = true; } }, { fetchImpl: async () => ({ ok: true, text: async () => "# Setup" }), open: (...a) => { opened.push(a); return {}; }, blobUrl: (t) => `blob:${t}`, href: "/h" });
  assert.equal(ok, true); assert.equal(prevented, true); assert.equal(opened[0][0], "blob:# Setup");
  const fb = []; await openSetupGuide(null, { fetchImpl: async () => ({ ok: false, status: 404 }), open: (...a) => { fb.push(a[0]); return {}; }, href: "/h" });
  assert.deepEqual(fb, ["/h"], "falls back to opening the file itself");
  const none = await openSetupGuide(null, { fetchImpl: async () => { throw new Error("x"); }, open: () => { throw new Error("blocked"); }, href: "/h" });
  assert.equal(none, false, "never throws");
});

// ---------- 4. stopped sounds leave game.audio.playing ----------
const cmdsSrc = await import("../scripts/commands.mjs").catch(() => null);
test("0.9.6 #4 purgePlaying removes a stopped (paused, position 0) sound by id and by identity, and only that one", () => {
  const purge = cmdsSrc?.purgePlaying; assert.equal(typeof purge, "function");
  const mine = { id: "s1", playing: false, currentTime: 0 }, other = { id: "s2", playing: true }, odd = { id: "s3" };
  const playing = new Map([["s1", mine], ["s2", other], ["zz", odd]]);
  assert.equal(purge(mine, { playing }), true); assert.deepEqual([...playing.keys()], ["s2", "zz"]);
  const m2 = new Map([["other-key", odd], ["s2", other]]); assert.equal(purge(odd, { playing: m2 }), true, "found by identity when the key differs");
  assert.deepEqual([...m2.keys()], ["s2"]);
  assert.equal(purge(mine, { playing }), false); assert.equal(purge(null, { playing }), false); assert.equal(purge(mine, {}), false);
});
test("0.9.6 #4 stopCurrentClip purges the sound it stops (Pause then Play, Pause then GM, wait)", () => {
  const cmds = src("scripts/commands.mjs");
  assert.match(cmds, /export function stopCurrentClip\(\) \{[\s\S]*?purgePlaying\(c\.sound\);[\s\S]*?c\.fin\(\)/);
});

// ---------- 3. moraleCheck replies fast ----------
test("0.9.6 #3 a bot's moraleCheck waits at most MORALE_REPLY_MS (waitMs overrides); the automatic run waits for the full result", () => {
  const { MORALE_REPLY_MS, moraleReplyMs } = cmdsSrc;
  assert.equal(MORALE_REPLY_MS, 10000); assert.ok(MORALE_REPLY_MS < 20000, "under the command timeout");
  assert.equal(moraleReplyMs({ all: true }), 10000); assert.equal(moraleReplyMs({ waitMs: 3000 }), 3000);
  assert.equal(moraleReplyMs({ waitMs: 0 }), 0, "0 = wait for the whole run"); assert.equal(moraleReplyMs({ waitMs: 999999 }), 60000);
  assert.equal(moraleReplyMs({ trigger: "moraleprompt:c1:halfDown" }), 0);
});
