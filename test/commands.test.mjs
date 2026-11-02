// Commands against a minimal fake Foundry (globals), to check JSON shape, ack ordering and the PB adapter wiring.
import test from "node:test"; import assert from "node:assert/strict";
const msgs = []; let failCreate = false;
const actor = { id: "a1", name: "Bart", type: "character", system: { attributes: { hp: { value: 5, max: 8 }, luck: { value: 2 }, rituals: { value: 1, max: 3, min: 0 }, extraResource: { value: 2, max: 4, min: 0 } } },
  items: [{ type: "class", system: { extraResourceNamePlural: "Prayers" } }],
  async update(u) { for (const [k, v] of Object.entries(u)) setP(this, k, v); } };
function getP(o, p) { return p.split(".").reduce((x, k) => x?.[k], o); }
function setP(o, p, v) { const ks = p.split("."); const l = ks.pop(); ks.reduce((x, k) => x[k], o)[l] = v; }
globalThis.foundry = { utils: { getProperty: getP, escapeHTML: s => s }, audio: { AudioHelper: { play: async () => ({ duration: 0.01 }) } } };
globalThis.game = { system: { id: "pirateborg" }, settings: { get: () => "system.hp.value" }, actors: { get: id => id === "a1" ? actor : null, getName: n => n === "Bart" ? actor : null },
  users: { get: id => id === "u1" ? { id: "u1", name: "David" } : null, getName: n => n === "David" ? { id: "u1", name: "David" } : null } };
globalThis.ChatMessage = { getSpeaker: () => ({ alias: "GM" }), create: async d => { if (failCreate && d.content.includes("<audio")) throw new Error("x"); const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; } };
globalThis.fetch = async (u) => ({ ok: !String(u).includes("missing") });
const { runCommand } = await import("../scripts/commands.mjs");
const { DedupeStore } = await import("../scripts/lib/dedupe.mjs");
const mkctx = () => { const order = []; return { order, dedupe: new DedupeStore(), persistNow: async () => order.push("persist"), ack: async ids => order.push("ack:" + ids.join()) }; };

test("setHP on pirateborg uses attributes.hp", async () => {
  const r = await runCommand({ name: "setHP", args: { actorName: "Bart", value: 3 } }, mkctx());
  assert.equal(r.ok, true); assert.equal(r.result.path, "system.attributes.hp.value"); assert.equal(actor.system.attributes.hp.value, 3);
});
test("setResource prayers vs rituals vs luck, clamped", async () => {
  const p = await runCommand({ name: "setResource", args: { actorId: "a1", resource: "prayers", delta: -5 } }, mkctx());
  assert.equal(p.result.resource, "Prayers"); assert.equal(actor.system.attributes.extraResource.value, 0);
  const r = await runCommand({ name: "setResource", args: { actorId: "a1", resource: "rituals", delta: 10 } }, mkctx());
  assert.equal(r.result.after, 3);
  const l = await runCommand({ name: "setResource", args: { actorId: "a1", resource: "devils luck", value: 1 } }, mkctx());
  assert.equal(actor.system.attributes.luck.value, 1); assert.equal(l.ok, true);
  assert.equal((await runCommand({ name: "setResource", args: { actorId: "a1", resource: "hp" } }, mkctx())).code, 400);
  const g = await runCommand({ name: "getResources", args: { actorId: "a1" } }, mkctx()); assert.ok(g.result.resources.Prayers);
});
test("whisper resolves names, acks after post, dedupes replyTo", async () => {
  const c = mkctx(); const r = await runCommand({ name: "whisper", args: { content: "psst", to: ["David"], replyTo: "q1", ackEventIds: ["chat:q1"] } }, c);
  assert.deepEqual(msgs.at(-1).whisper, ["u1"]); assert.deepEqual(c.order, ["persist", "ack:chat:q1"]);
  assert.equal((await runCommand({ name: "whisper", args: { content: "again", to: ["David"], replyTo: "q1" } }, c)).result.duplicate, true);
  assert.equal((await runCommand({ name: "whisper", args: { content: "x", to: ["Nobody"] } }, c)).code, 404);
  assert.equal((await runCommand({ name: "whisper", args: { content: "x", to: "David" } }, c)).code, 400);
});
test("postVoice: voice when audio ok, text fallback when missing or post fails; ack after post", async () => {
  const c = mkctx();
  const v = await runCommand({ name: "postVoice", args: { content: "Arr", audioPath: "worlds/x/a.mp3", replyTo: "r1", ackEventIds: ["chat:r1"] } }, c);
  assert.equal(v.result.mode, "voice"); assert.deepEqual(c.order, ["persist", "ack:chat:r1"]);
  const t = await runCommand({ name: "postVoice", args: { content: "Arr", audioPath: "missing.mp3", replyTo: "r2" } }, mkctx());
  assert.equal(t.result.mode, "text"); assert.ok(!msgs.at(-1).content.includes("<audio"));
  failCreate = true; const f = await runCommand({ name: "postVoice", args: { content: "Arr", audioPath: "ok.mp3", replyTo: "r3" } }, mkctx()); failCreate = false;
  assert.equal(f.result.mode, "text");
});
test("playAudio queues, 404 for missing, wait returns played", async () => {
  assert.equal((await runCommand({ name: "playAudio", args: { path: "missing.mp3" } }, mkctx())).code, 404);
  const r = await runCommand({ name: "playAudio", args: { path: "a.mp3", id: "clip1", wait: true } }, mkctx());
  assert.deepEqual(r.result, { id: "clip1", played: true });
  assert.equal((await runCommand({ name: "playAudio", args: { path: "a.mp3", id: "clip1", wait: true } }, mkctx())).result.duplicate, true);
});

test("extraResource label: Sorceries class cannot be set as prayers; actor getter wins", async () => {
  actor.items = [{ type: "class", system: { extraResourceNamePlural: "Sorceries" } }];
  assert.equal((await runCommand({ name: "setResource", args: { actorId: "a1", resource: "prayers", value: 1 } }, mkctx())).ok, false);
  actor.extraResourceNamePlural = "Prayers";
  assert.equal((await runCommand({ name: "setResource", args: { actorId: "a1", resource: "prayer", value: 1 } }, mkctx())).ok, true);
});

test("move (v14 async): returns final x,y only after the token arrives; 504 if it never does", async () => {
  const hooks = new Map(); let n = 0;
  globalThis.Hooks = { on: (h, f) => { hooks.set(++n, f); return n; }, off: (h, id) => hooks.delete(id) };
  const tok = { id: "t1", name: "Ship", x: 200, y: 200, async update(u) { setTimeout(() => { Object.assign(this, u); for (const f of hooks.values()) f(this); }, 15); } };
  globalThis.canvas = { scene: { tokens: { get: id => id === "t1" ? tok : null, find: () => null } } };
  const r = await runCommand({ name: "move", args: { tokenId: "t1", x: 300, y: 300 } }, mkctx());
  assert.deepEqual(r, { ok: true, result: { tokenId: "t1", x: 300, y: 300 } }); assert.equal(tok.x, 300); assert.equal(hooks.size, 0);
});
test("postVoice: voice cache reuse without audioPath; ttsMinChars posts short replies as text", async () => {
  const { VoiceCache } = await import("../scripts/lib/voicecache.mjs");
  const c = { ...mkctx(), voiceCache: new VoiceCache(), ttsMinChars: 10 };
  const a = await runCommand({ name: "postVoice", args: { content: "Welcome aboard, scallywag!", audioPath: "v/w.mp3", replyTo: "v1" } }, c);
  assert.equal(a.result.mode, "voice");
  const l = await runCommand({ name: "voiceLookup", args: { content: "welcome aboard,  scallywag!" } }, c); assert.equal(l.result.cached, "v/w.mp3");
  const b = await runCommand({ name: "postVoice", args: { content: "Welcome aboard, scallywag!", replyTo: "v2" } }, c);
  assert.equal(b.result.mode, "voice"); assert.equal(b.result.cacheHit, true);
  const s = await runCommand({ name: "postVoice", args: { content: "Aye.", audioPath: "v/a.mp3", replyTo: "v3" } }, c);
  assert.equal(s.result.mode, "text"); assert.equal(s.result.skippedTts, true);
  assert.equal((await runCommand({ name: "voiceLookup", args: { content: "Aye." } }, c)).result.skipTts, true);
});
