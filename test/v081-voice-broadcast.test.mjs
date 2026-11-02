// #12: bot voice must reach player clients via the module socket and play locally (never core broadcast).
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const plays = []; const emits = [];
globalThis.foundry = { utils: { getProperty: () => undefined, escapeHTML: s => s }, audio: { AudioHelper: { play: async (d, push) => { plays.push({ src: d.src, push }); return { duration: 0.01 }; } } } };
globalThis.game = { audio: { locked: false }, socket: { emit: (n, d) => emits.push({ n, d }) }, i18n: {}, settings: { get: () => null } };
globalThis.fetch = async () => ({ ok: true });
const { runCommand, onVoiceSocket } = await import("../scripts/commands.mjs");
const ctx = { dedupe: null, persistNow: async () => {}, ack: async () => {} };

test("playAudio emits a voice socket message and plays locally without core broadcast", async () => {
  const r = await runCommand({ name: "playAudio", args: { path: "a/v1.mp3", id: "v1", wait: true } }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(emits.at(-1), { n: "module.ai-gm-bridge", d: { type: "voice", id: "v1", src: "a/v1.mp3", volume: undefined } });
  assert.equal(plays.at(-1).src, "a/v1.mp3"); assert.equal(plays.at(-1).push, false);
});
test("player client plays a received voice message through its queue, once", async () => {
  const r = await onVoiceSocket({ type: "voice", id: "v2", src: "a/v2.mp3", volume: 0.5 });
  assert.equal(r.played, true); assert.equal(plays.at(-1).src, "a/v2.mp3");
  assert.equal((await onVoiceSocket({ type: "voice", id: "v2", src: "a/v2.mp3" })).duplicate, true);
});
test("malformed voice socket data is ignored", () => {
  assert.equal(onVoiceSocket({ type: "voice" }), null); assert.equal(onVoiceSocket({ type: "x", src: "s" }), null);
});
test("player audio goes through the queue (so the unlock prompt covers it) and main routes voice", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /data\.type === "voice"\) return void onVoiceSocket/);
  const c = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(c, /loop: false \}, true\)/);
});
