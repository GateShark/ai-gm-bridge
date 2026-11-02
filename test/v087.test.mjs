import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unwrapText, sceneBackgroundSrc } from "../scripts/lib/v081.mjs";
import { AudioQueue, installAudioResume } from "../scripts/lib/audioqueue.mjs";
test("0.8.7 unwrapText unwraps JSON text bodies, leaves plain text", () => {
  assert.equal(unwrapText('{"text":"Yer torch hits."}'), "Yer torch hits.");
  assert.equal(unwrapText(' {"content":"hi"} '), "hi");
  assert.equal(unwrapText({ text: "obj" }), "obj");
  assert.equal(unwrapText("plain {braces}"), "plain {braces}");
  assert.equal(unwrapText("{not json}"), "{not json}");
  assert.equal(unwrapText('{"x":1}'), '{"x":1}');
});
test("0.8.7 sceneBackgroundSrc prefers v14 level background", () => {
  assert.equal(sceneBackgroundSrc({ levels: { contents: [{ background: { src: "a.webp" } }] }, background: { src: "b.webp" } }), "a.webp");
  assert.equal(sceneBackgroundSrc({ levels: { contents: [{ background: { src: null } }] }, background: { src: "b.webp" } }), "b.webp");
  assert.equal(sceneBackgroundSrc({ levels: { contents: [] } }), null);
});
function fakeDoc() { const h = {}; return { h, visibilityState: "visible", addEventListener: (e, f) => (h[e] = f), getElementById: () => null }; }
test("0.8.7 any gesture or tab refocus resumes a blocked audio queue", async () => {
  let blockedOnce = true; const played = [];
  const q = new AudioQueue({ play: async (c) => { if (blockedOnce) { blockedOnce = false; const e = new Error("x"); e.name = "NotAllowedError"; throw e; } played.push(c); }, gapMs: 0, sleep: async () => {} });
  const doc = fakeDoc(); assert.ok(installAudioResume({ queue: q, doc }));
  q.enqueue("1", "a.mp3"); await new Promise(r => setTimeout(r, 5)); assert.ok(q.blocked);
  await doc.h.pointerdown(); await new Promise(r => setTimeout(r, 5)); assert.deepEqual(played, ["a.mp3"]);
  blockedOnce = true; q.enqueue("2", "b.mp3"); await new Promise(r => setTimeout(r, 5)); assert.ok(q.blocked);
  await doc.h.visibilitychange(); await new Promise(r => setTimeout(r, 5)); assert.deepEqual(played, ["a.mp3", "b.mp3"]);
});
test("0.8.7 no hardcoded old version; pre-ready api stub", () => {
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(main, /v0\.8\.0/); assert.match(main, /whenReady/); assert.match(main, /ready: true/);
  assert.equal(JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version, "0.8.7");
});
