import test from "node:test"; import assert from "node:assert/strict";
import { AudioQueue, voiceOrText } from "../scripts/lib/audioqueue.mjs";
import { resolveResource, nextValue, summarize } from "../scripts/lib/pirateborg.mjs";
test("audio queue is serial and dedupes by id", async () => {
  const log = []; let active = 0, maxActive = 0;
  const q = new AudioQueue({ gapMs: 0, play: async c => { active++; maxActive = Math.max(maxActive, active); log.push(c); await new Promise(r => setTimeout(r, 5)); active--; } });
  const r = await Promise.all([q.enqueue("a", "A"), q.enqueue("b", "B"), q.enqueue("a", "A2")]);
  assert.deepEqual(log, ["A", "B"]); assert.equal(maxActive, 1); assert.ok(r[2].duplicate);
});
test("audio queue: failed clip can be retried", async () => {
  let fail = true; const q = new AudioQueue({ gapMs: 0, retries: 0, play: async () => { if (fail) { fail = false; throw new Error("x"); } } });
  assert.equal((await q.enqueue("a", 1)).played, false); assert.equal((await q.enqueue("a", 1)).played, true);
});
test("voice falls back to text when audio missing or voice post fails", async () => {
  const base = { playVoice: async () => {}, postText: async () => "t1", postVoice: async () => "v1" };
  assert.deepEqual(await voiceOrText({ ...base, audioPath: "a.mp3", checkAudio: async () => true }), { mode: "voice", messageId: "v1" });
  const r = await voiceOrText({ ...base, audioPath: "a.mp3", checkAudio: async () => false }); assert.equal(r.mode, "text"); assert.equal(r.messageId, "t1");
  const r2 = await voiceOrText({ ...base, audioPath: "a.mp3", checkAudio: async () => true, postVoice: async () => { throw new Error("boom"); } }); assert.equal(r2.mode, "text");
  assert.equal((await voiceOrText({ ...base, checkAudio: async () => true })).mode, "text");
});
test("pirateborg: hp/luck/rituals paths; prayers only via class extra resource", () => {
  assert.equal(resolveResource("character", "HP").base, "system.attributes.hp");
  assert.equal(resolveResource("character", "Devil's Luck").base, "system.attributes.luck");
  assert.equal(resolveResource("character", "rituals").base, "system.attributes.rituals");
  assert.equal(resolveResource("character", "prayers", "Prayers").key, "extraResource");
  assert.equal(resolveResource("character", "prayer", "Prayers").key, "extraResource");
  assert.match(resolveResource("character", "prayers").error, /no prayers pool/);
  assert.match(resolveResource("character", "prayers", "Shanties").error, /not prayers/);
  assert.match(resolveResource("creature", "luck").error, /unknown/);
  assert.equal(resolveResource("vehicle_npc", "hull").base, "system.attributes.hull");
});
test("nextValue clamps and supports delta", () => {
  assert.equal(nextValue({ value: 3, max: 5, min: 0 }, { delta: -10 }), 0);
  assert.equal(nextValue({ value: 3, max: 5 }, { delta: 10 }), 5);
  assert.equal(nextValue({ value: 3, max: 0 }, { value: 7 }), 7); // max 0 = unset
  assert.equal(nextValue({ value: 1 }, { value: 4 }), 4);
});
test("summarize uses class label for extra resource", () => {
  const s = summarize("character", { attributes: { hp: { value: 4, max: 9 }, luck: { value: 2 }, rituals: { value: 0, max: 0 }, extraResource: { value: 3, max: 4 } } }, "Prayers");
  assert.deepEqual(s.Prayers, { value: 3, max: 4 }); assert.deepEqual(s.hp, { value: 4, max: 9 }); assert.equal(s.devilsLuck, undefined);
});
