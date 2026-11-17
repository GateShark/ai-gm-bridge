// 0.9.3: group damage, no morale cards after a sweep, setResource mirrored, bot wake for any world (world fields, bot not
// receiving warning, Test connection), v14 level backgrounds, multi-player safety, setup guide. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildPayload } from "../scripts/lib/compact.mjs";
import { Outbox, relayAutoAckIds } from "../scripts/lib/outbox.mjs";
import { Batcher } from "../scripts/lib/batcher.mjs";
import { decideLeader, applyHeartbeat } from "../scripts/lib/leader.mjs";
import { worldInfo, evaluateReceiving, liveBotReceiving, setOutboxProvider, createDeliveryHealth, createReceivingNotifier, ACK_WINDOW_MS } from "../scripts/lib/botwake.mjs";
import { runSetupCheck, liveSetupCheck, formatConnectionWithSetup } from "../scripts/lib/setupcheck.mjs";
import { panelHtml } from "../scripts/lib/gmpanel.mjs";
import { testConnection } from "../scripts/lib/settingsui.mjs";
import { coreGeneration, sceneUsesLevels, setSceneBackground, sceneBackgroundSrc } from "../scripts/lib/v081.mjs";
import { rollReplyKey, rollScope, priorRollReply, recordRollReply } from "../scripts/lib/replies.mjs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
import { turnVoiceUserIds } from "../scripts/lib/turns.mjs";
import { pickAudioSrc } from "../scripts/lib/voices.mjs";
import { SETUP_GUIDE_URL } from "../scripts/lib/setupprompt.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ID = "ai-gm-bridge";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);

// ---------- minimal Foundry ----------
const msgs = []; const cards = []; const sockets = []; const emitted = [];
const setByPath = (o, path, v) => { const ks = path.split("."); let t = o; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; t[ks.at(-1)] = v; };
function mkMsg(d) {
  const m = { id: "m" + (msgs.length + 1), timestamp: Date.now(), flags: {}, ...d,
    async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "content") m.content = v; else if (k.startsWith("flags.")) setByPath(m.flags, k.slice(6), v); } return m; } };
  msgs.push(m); return m;
}
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd" + msgs.length, getProperty, escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { return mkMsg(d); }, getSpeaker: () => ({ alias: "GM" }) };
globalThis.Roll = class { static validate() { return true; } constructor(f) { this.formula = f; } async evaluate() { this.total = 4; return this; } };
const pat = { id: "p1", name: "Pat", isGM: false, active: true };
const sam = { id: "p2", name: "Sam", isGM: false, active: true };
const settingsStore = { hpPath: "system.attributes.hp.value" };
const mkActor = (id, name, { hp, max = 10, pc = false, type = pc ? "character" : "creature", extra = {} } = {}) => ({ id, name, type, hasPlayerOwner: pc, made: [], system: { attributes: { hp: { value: hp, max }, morale: 7 }, ...extra }, prototypeToken: { actorLink: false },
  getRollData() { return {}; }, async update(d) { for (const [k, v] of Object.entries(d)) setByPath(this, k, v); } });
const tempusW = mkActor("a1", "Tempus", { hp: 10, pc: true, extra: { luck: { value: 3, max: 3 } } });
const tempusT = mkActor("a1", "Tempus", { hp: 8, pc: true, extra: { luck: { value: 3, max: 3 } } }); tempusT.isToken = true;
const barkW = mkActor("a2", "Bart", { hp: 9, pc: true });
const ratBase = mkActor("n1", "Bilge Rat", { hp: 4, max: 4 });
const mkRatTok = (id, hp = 4) => { const a = mkActor("n1", "Bilge Rat", { hp, max: 4 }); a.isToken = true; return { id, name: "Bilge Rat " + id, actorLink: false, actorId: "n1", actor: a, disposition: -1, async update(d) { Object.assign(this, d); } }; };
let ratToks = [mkRatTok("tA"), mkRatTok("tB"), mkRatTok("tC")];
const tempusTok = { id: "tT", name: "Tempus", actorLink: false, actorId: "a1", actor: tempusT, async update(d) { Object.assign(this, d); } };
const sceneToks = () => [...ratToks, tempusTok];
const mkScene = (id, toksFn) => ({ id, name: id, tokens: { get contents() { return toksFn(); }, get: (i) => toksFn().find(t => t.id === i) ?? null, find: (f) => toksFn().find(f) } });
const scene = mkScene("s1", sceneToks);
const combats = [];
globalThis.canvas = { scene, tokens: { controlled: [] } };
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest", title: "PB Test" }, user: { id: "gm", isGM: true }, ready: true, paused: false, release: { generation: 14 },
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: id => [pat, sam].find(u => u.id === id) ?? null, find: f => [pat, sam].find(f), contents: [pat, sam], getName: n => [pat, sam].find(u => u.name === n) ?? null },
  actors: { contents: [tempusW, barkW, ratBase], get: id => [tempusW, barkW, ratBase].find(a => a.id === id) ?? null, getName: n => [tempusW, barkW, ratBase].find(a => a.name === n) ?? null },
  scenes: { active: scene, viewed: scene, contents: [], *[Symbol.iterator]() {}, get: id => id === "s1" ? scene : null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) ?? null },
  socket: { emit: (c, d) => sockets.push(d) }, combat: null, combats: { get contents() { return combats; }, get: id => combats.find(c => c.id === id) ?? null } };
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async (p) => {
  if (p.endsWith("generic-card.js")) return { showGenericCard: async (o) => { cards.push(o); } };
  if (p.endsWith("morale-outcome.js")) return { createMoraleOutcome: async ({ actor }) => { await hooksDuringRoll(); return { id: "o" + Math.random(), roll: { total: 4 }, isStandingFirm: true, isFleeing: false, isSurrendering: false }; } };
  throw new Error("no fake " + p);
});
let hooksDuringRoll = async () => {};
const store = new DedupeStore();
const C = await import("../scripts/commands.mjs");
const F = await import("../scripts/features.mjs");
F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ rollRequestTimeoutMs: 600000, moraleAuto: true })[k], amLeader: () => true, dedupeOf: () => store, log: () => {} });
const ctx = { dedupe: store, persistNow: async () => {} };
const run = (name, args) => C.runCommand({ name, args }, ctx);
const reset = () => {
  ratToks = [mkRatTok("tA"), mkRatTok("tB"), mkRatTok("tC")]; tempusW.system.attributes.hp.value = 10; tempusT.system.attributes.hp.value = 8;
  tempusW.system.luck.value = 3; tempusT.system.luck.value = 3; canvas.tokens.controlled = []; msgs.length = 0; cards.length = 0; emitted.length = 0; sockets.length = 0; combats.length = 0; game.combat = null;
};

// ---------- 1. group damage ----------
test("0.9.3 #1 applyDamage hits every targeted unlinked token that shares one actor (a group of the same monster)", async () => {
  reset();
  const r = await run("applyDamage", { amount: 4, tokenIds: ["tA", "tB", "tC"], sceneId: "s1" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.updated.length, 3);
  assert.deepEqual(r.result.updated.map(u => u.tokenId), ["tA", "tB", "tC"]);
  assert.ok(r.result.updated.every(u => u.id === "n1" && u.before === 4 && u.after === 0));
  for (const t of ratToks) assert.equal(t.actor.system.attributes.hp.value, 0, t.id);
  assert.equal(ratBase.system.attributes.hp.value, 4, "the world actor is untouched");
});

test("0.9.3 #1 each unlinked token keeps its own HP: a partial group takes damage per token", async () => {
  reset(); ratToks[1].actor.system.attributes.hp.value = 2;
  const r = await run("applyDamage", { amount: 3, tokenIds: ["tA", "tB", "tC"], sceneId: "s1" });
  assert.deepEqual(r.result.updated.map(u => [u.tokenId, u.before, u.after]), [["tA", 4, 1], ["tB", 2, 0], ["tC", 4, 1]]);
  const names = await run("applyDamage", { amount: 1, tokenNames: ["Bilge Rat tA", "Bilge Rat tC"], sceneId: "s1" });
  assert.equal(names.result.updated.length, 2); assert.equal(ratToks[0].actor.system.attributes.hp.value, 0);
});

test("0.9.3 #1 a group plus a PC: the rats are token-only and the PC keeps the dual write (sheet and token)", async () => {
  reset();
  const r = await run("applyDamage", { amount: 2, tokenIds: ["tA", "tB", "tT", "tC"], sceneId: "s1" });
  assert.equal(r.ok, true, r.error); assert.equal(r.result.updated.length, 4);
  assert.equal(tempusT.system.attributes.hp.value, 6); assert.equal(tempusW.system.attributes.hp.value, 6, "PC world sheet gets the same value (0.9.2 rule)");
  for (const t of ratToks) assert.equal(t.actor.system.attributes.hp.value, 2);
  assert.equal(ratBase.system.attributes.hp.value, 4);
});

test("0.9.3 #1 the same token or actor named twice still counts once; linked tokens of one actor count once", async () => {
  reset();
  const twice = await run("applyDamage", { amount: 1, tokenIds: ["tA", "tA"], tokenId: "tA", sceneId: "s1" });
  assert.equal(twice.result.updated.length, 1); assert.equal(ratToks[0].actor.system.attributes.hp.value, 3);
  const byActor = await run("applyDamage", { amount: 1, actorIds: ["a2", "a2"], actorName: "Bart" });
  assert.equal(byActor.result.updated.length, 1); assert.equal(barkW.system.attributes.hp.value, 8);
  // two linked tokens of one actor: one write, one entry
  const lt = (id) => ({ id, name: "Bart", actorLink: true, actorId: "a2", actor: barkW, baseActor: barkW });
  const keep = scene.tokens.contents; ratToks = [lt("l1"), lt("l2")];
  const linked = await run("applyDamage", { amount: 1, tokenIds: ["l1", "l2"], sceneId: "s1" });
  assert.equal(linked.result.updated.length, 1); assert.equal(barkW.system.attributes.hp.value, 7);
  barkW.system.attributes.hp.value = 9; void keep;
});

test("0.9.3 #1 selected (controlled) unlinked tokens of one actor are all hit too", async () => {
  reset();
  canvas.tokens.controlled = ratToks.map(t => ({ id: t.id, name: t.name, actor: t.actor, document: t }));
  const r = await run("applyDamage", { amount: 4 });
  assert.equal(r.ok, true, r.error); assert.equal(r.result.updated.length, 3);
  for (const t of ratToks) assert.equal(t.actor.system.attributes.hp.value, 0);
  canvas.tokens.controlled = [];
});

// ---------- 2. morale cards after a sweep ----------
function startFight(hps = [4, 4, 4]) {
  const cbs = ratToks.map((t, i) => { t.actor.system.attributes.hp.value = hps[i]; return { id: `cb${i}`, name: t.name, actor: t.actor, actorId: t.actor.id, isNPC: true, tokenId: t.id, token: { id: t.id, actor: t.actor, disposition: -1 } }; });
  const combat = { id: "mc1", started: true, round: 1, turn: 0, combatants: { contents: cbs }, turns: cbs };
  combats.push(combat); game.combat = combat; return { combat, cbs };
}
test("0.9.3 #2 an automatic morale run posts no card when a sweep ends the fight during the roll", async () => {
  reset(); const f = startFight();
  hooksDuringRoll = async () => { for (const cb of f.cbs) cb.actor.system.attributes.hp.value = 0; combats.length = 0; game.combat = null; };
  const r = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:firstEnemyDown", reason: "firstEnemyDown" });
  hooksDuringRoll = async () => {};
  assert.equal(r.ok, true, r.error); assert.equal(r.result.skipped, "combatEnded"); assert.equal(r.result.checked, 0);
  assert.equal(cards.length, 0, "no morale card"); assert.equal(msgs.length, 0);
});

test("0.9.3 #2 the fight already over before the first card: nothing is rolled or posted; the skipped run is not cached", async () => {
  reset(); const f = startFight([0, 0, 0]);
  const r = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:halfDown", reason: "halfDown" });
  assert.equal(r.ok, true, r.error); assert.equal(r.result.checked, 0); assert.equal(cards.length, 0);
  // an automatic prompt through features: dropped, nothing emitted
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], log: () => {}, runMorale: (p) => run("moraleCheck", { all: true, trigger: p.eventId, reason: p.reason }) });
  const out = await F.handleMoralePrompt({ eventId: "moraleprompt:mc1:firstEnemyDown", type: "moralePrompt", combatId: "mc1" });
  assert.ok(out.skipped); assert.equal(emitted.length, 0); assert.equal(cards.length, 0);
});

test("0.9.3 #2 a normal fight still posts one card per living enemy; a manual moraleCheck (no trigger) is unchanged", async () => {
  reset(); startFight([4, 4, 0]);
  const auto = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:firstEnemyDown", reason: "firstEnemyDown" });
  assert.equal(auto.ok, true, auto.error); assert.equal(auto.result.checked, 2); assert.equal(cards.length, 2);
  const manual = await run("moraleCheck", { all: true, force: true });
  assert.equal(manual.ok, true); assert.equal(manual.result.checked, 2); assert.equal(cards.length, 4);
  assert.match(src("scripts/commands.mjs"), /String\(a\.trigger \?\? ""\)\.startsWith\("moraleprompt:"\)/);
});

// ---------- 3. setResource mirrored ----------
test("0.9.3 #3 setResource hp on a PC token that writes sheet and token reports mirrored:true; monsters and other resources do not", async () => {
  reset();
  const r = await run("setResource", { tokenName: "Tempus", resource: "hp", delta: -1 });
  assert.equal(r.ok, true, r.error); assert.equal(r.result.mirrored, true);
  assert.equal(tempusT.system.attributes.hp.value, 7); assert.equal(tempusW.system.attributes.hp.value, 7, "same value on the sheet");
  const s = await run("setHP", { tokenName: "Tempus", delta: -1 }); assert.equal(s.result.mirrored, true);
  const rat = await run("setResource", { tokenId: "tA", sceneId: "s1", resource: "hp", delta: -1 });
  assert.equal(rat.ok, true); assert.equal(rat.result.mirrored, undefined); assert.equal(rat.result.via, "token");
  const luck = await run("setResource", { tokenName: "Tempus", resource: "luck", delta: -1 });
  assert.equal(luck.ok, true, luck.error); assert.equal(luck.result.mirrored, undefined, "only HP is mirrored");
  const world = await run("setResource", { actorName: "Bart", resource: "hp", delta: -1 });
  assert.equal(world.result.mirrored, undefined);
});

// ---------- 4. bot wake for any world ----------
test("0.9.3 #4 every batch and every event carries worldId, worldTitle and systemId", () => {
  const info = worldInfo();
  assert.deepEqual(info, { worldId: "pbtest", worldTitle: "PB Test", systemId: "pirateborg" });
  const batch = { batchId: "pbtest:abc", world: "pbtest", seq: 3, attempt: 1, events: [{ eventId: "chat:1", type: "chat", author: "Pat", text: "hi" }, { eventId: "rollreq:r1", type: "rollResult", actor: "Tempus" }, { eventId: "combat:c:1.0", type: "turn", combat: { id: "c" } }] };
  const p = buildPayload(batch, { worldInfo: info });
  assert.equal(p.world, "pbtest"); assert.equal(p.worldId, "pbtest"); assert.equal(p.worldTitle, "PB Test"); assert.equal(p.systemId, "pirateborg");
  assert.equal(p.events.length, 3);
  for (const e of p.events) { assert.equal(e.worldId, "pbtest"); assert.equal(e.worldTitle, "PB Test"); assert.equal(e.systemId, "pirateborg"); }
  assert.equal(p.events[0].author, "Pat");
  assert.equal(buildPayload(batch).worldId, undefined, "no info, no fields (old callers)");
  const other = worldInfo({ world: { id: "cc-test", title: "C&C Test" }, system: { id: "castles-and-crusades" } });
  assert.deepEqual(other, { worldId: "cc-test", worldTitle: "C&C Test", systemId: "castles-and-crusades" });
  assert.deepEqual(worldInfo({}), { worldId: null, worldTitle: null, systemId: null });
  const main = src("scripts/main.mjs");
  assert.match(main, /buildPayload\(batch, \{[^}]*worldInfo: worldInfo\(\)/);
  assert.match(src("scripts/config-app.mjs"), /worldInfo: worldInfo\(\)/);
});

test("0.9.3 #4 the real outbox keeps the fields stored events never carry: they are added when the batch is built", () => {
  const ob = new Outbox(); ob.enqueue({ eventId: "chat:1", type: "chat", author: "Pat", text: "hi" }, 1000);
  assert.equal(ob.items[0].event.worldId, undefined);
  const b = ob.nextBatch(1000, "pbtest");
  const p = buildPayload(b, { worldInfo: worldInfo() });
  assert.equal(p.events[0].worldId, "pbtest");
  assert.equal(ob.items[0].event.worldId, undefined, "persisted events stay small");
});

const base = { enabled: true, delivery: "direct", webhookUrl: "https://bot.example/hook", botFound: true, items: [], failures: 0, now: 1_000_000 };
test("0.9.3 #4 evaluateReceiving: disabled is silent; relay with no URL is fine; direct with an empty URL warns", () => {
  assert.equal(evaluateReceiving({ ...base, enabled: false, webhookUrl: "" }).state, "off");
  assert.equal(evaluateReceiving({ ...base }).state, "ok");
  assert.equal(evaluateReceiving({ ...base, delivery: "relay", webhookUrl: "" }).state, "ok");
  const e = evaluateReceiving({ ...base, webhookUrl: "  " });
  assert.equal(e.state, "warn"); assert.equal(e.ok, false); assert.deepEqual(e.problems.map(p => p.code), ["noWebhook"]);
  assert.match(e.text, /Bot not receiving/); assert.match(e.text, /webhook URL is empty/); assert.match(e.text, /SETUP\.md/);
});

test("0.9.3 #4 evaluateReceiving: no bot user, repeated failures and a missing ack each warn; a young or answered queue does not", () => {
  assert.deepEqual(evaluateReceiving({ ...base, botFound: false }).problems.map(p => p.code), ["noBotUser"]);
  assert.equal(evaluateReceiving({ ...base, failures: 2 }).state, "ok");
  const f = evaluateReceiving({ ...base, failures: 3, lastStatus: 502 });
  assert.deepEqual(f.problems.map(p => p.code), ["deliveryFailing"]); assert.match(f.text, /HTTP 502/);
  assert.match(evaluateReceiving({ ...base, failures: 4, lastError: "Failed to fetch" }).text, /Failed to fetch/);
  const sent = (age, attempts = 3) => ({ attempts, firstAt: base.now - age, nextAt: base.now + 1000, event: { eventId: "chat:1" } });
  assert.equal(evaluateReceiving({ ...base, items: [sent(ACK_WINDOW_MS - 1000)] }).state, "ok", "within the window");
  const n = evaluateReceiving({ ...base, items: [sent(ACK_WINDOW_MS + 5000)] });
  assert.deepEqual(n.problems.map(p => p.code), ["noAck"]); assert.match(n.problems[0].text, /has not acknowledged it/);
  assert.match(evaluateReceiving({ ...base, items: [sent(ACK_WINDOW_MS + 1), sent(ACK_WINDOW_MS + 9)] }).problems[0].text, /2 events/);
  assert.equal(evaluateReceiving({ ...base, items: [{ attempts: 0, firstAt: base.now - 9e6, event: {} }] }).state, "ok", "never sent: not waiting for an ack");
  // an empty webhook is reported as itself, not twice
  assert.deepEqual(evaluateReceiving({ ...base, webhookUrl: "", items: [sent(ACK_WINDOW_MS + 5000)] }).problems.map(p => p.code), ["noWebhook"]);
  // relay mode: an unacked event also counts (relay auto-acks chat, so only control/stuck events can wait)
  assert.deepEqual(evaluateReceiving({ ...base, delivery: "relay", webhookUrl: "", items: [sent(ACK_WINDOW_MS + 5000)] }).problems.map(p => p.code), ["noAck"]);
});

test("0.9.3 #4 delivery health counts failures in a row and resets on success", () => {
  const h = createDeliveryHealth();
  h.fail({ status: 500 }, 1); h.fail({ error: "x".repeat(500) }, 2); assert.equal(h.failures, 2); assert.equal(h.lastError.length, 200);
  h.ok(3); assert.equal(h.failures, 0); assert.equal(h.lastError, null); assert.equal(h.lastOkAt, 3);
  const main = src("scripts/main.mjs");
  assert.match(main, /if \(r\.ok\) deliveryHealth\.ok\(\); else \{ deliveryHealth\.fail\(\{ status: r\.status, error: r\.error \}\)/);
});

test("0.9.3 #4 liveBotReceiving reads the world settings and is GM-only; the outbox comes from the leader or the stored copy", () => {
  const g = (over = {}, user = { isGM: true }) => ({ user, settings: { get: (m, k) => ({ enabled: true, delivery: "direct", webhookUrl: "", botUserId: "bot1", botUserName: "", outboxState: { items: [] }, ...over })[k] }, users: { contents: [{ id: "bot1", name: "AI GM", isGM: true }] } });
  setOutboxProvider(null);
  const r = liveBotReceiving({ g: g(), now: 5 }); assert.equal(r.state, "warn"); assert.deepEqual(r.problems.map(p => p.code), ["noWebhook"]);
  assert.equal(liveBotReceiving({ g: g({}, { isGM: false }) }).state, "off", "players never see it");
  assert.equal(liveBotReceiving({ g: g({ enabled: false }) }).state, "off");
  assert.deepEqual(liveBotReceiving({ g: g({ botUserId: "gone" }), now: 5 }).problems.map(p => p.code), ["noBotUser", "noWebhook"]);
  assert.equal(liveBotReceiving({ g: { ...g({ botUserId: "", botUserName: "ai gm", webhookUrl: "https://x" }) } }).state, "ok", "found by name prefix");
  const old = { attempts: 4, firstAt: 1000, event: {} };
  assert.deepEqual(liveBotReceiving({ g: g({ webhookUrl: "https://x", outboxState: { items: [old] } }), now: 1000 + ACK_WINDOW_MS + 1 }).problems.map(p => p.code), ["noAck"], "persisted copy");
  setOutboxProvider(() => []);
  assert.equal(liveBotReceiving({ g: g({ webhookUrl: "https://x", outboxState: { items: [old] } }), now: 1000 + ACK_WINDOW_MS + 1 }).state, "ok", "leader's live outbox wins");
  setOutboxProvider(null);
  const h = createDeliveryHealth(); h.fail({ status: 500 }); h.fail({ status: 500 }); h.fail({ status: 500 });
  assert.deepEqual(liveBotReceiving({ g: g({ webhookUrl: "https://x" }), health: h }).problems.map(p => p.code), ["deliveryFailing"]);
});

test("0.9.3 #4 the one-time notification fires once per problem and again only after it cleared", () => {
  const shown = []; const n = createReceivingNotifier({ notify: (t) => shown.push(t) });
  const warn = (...codes) => ({ state: "warn", problems: codes.map(c => ({ code: c })), text: "Bot not receiving: " + codes.join(",") });
  assert.equal(n.check(warn("noWebhook")), true); assert.equal(n.check(warn("noWebhook")), false); assert.equal(n.check(warn("noWebhook")), false);
  assert.equal(n.check(warn("noWebhook", "noAck")), true, "a new problem warns");
  assert.equal(n.check({ state: "ok", problems: [] }), false);
  assert.equal(n.check(warn("noWebhook")), true, "after it cleared it can warn again");
  assert.equal(shown.length, 3);
  const main = src("scripts/main.mjs");
  assert.match(main, /function checkReceiving[\s\S]*if \(!game\.user\?\.isGM\) return;[\s\S]*receivingNotifier\.check\(r\)/);
  assert.match(main, /function tickLeader\(\) \{\s*const now = Date\.now\(\); S\.batcher\?\.check\(\); checkReceiving\(now\);/);
});

test("0.9.3 #4 Check setup, the panel and Test connection show the warning; ok is false while the bot is not receiving", () => {
  const rec = evaluateReceiving({ ...base, webhookUrl: "" });
  const chk = runSetupCheck({ tokens: [], users: [pat], receiving: rec });
  assert.equal(chk.ok, false); assert.match(chk.warning, /Bot not receiving/); assert.deepEqual(chk.botReceiving.problems, ["noWebhook"]);
  assert.match(panelHtml({ setup: chk }), /Bot not receiving/);
  assert.match(formatConnectionWithSetup({ ok: true, message: "OK" }, chk), /OK — .*Bot not receiving/);
  const fine = runSetupCheck({ tokens: [], users: [pat], receiving: evaluateReceiving({ ...base }) });
  assert.equal(fine.ok, true); assert.equal(fine.botReceiving.ok, true); assert.equal(fine.warning, null);
  const off = runSetupCheck({ tokens: [], users: [pat], receiving: evaluateReceiving({ ...base, enabled: false }) });
  assert.equal(off.botReceiving, undefined, "add-on off: nothing to report");
  assert.equal(runSetupCheck({ tokens: [], users: [pat] }).ok, true, "old callers unchanged");
  // live path: the add-on is on in this fake world with delivery direct and no URL
  Object.assign(settingsStore, { enabled: true, delivery: "direct", webhookUrl: "", botUserId: "" , botUserName: "" });
  game.users.contents.push({ id: "bot", name: "AI GM", isGM: true }); settingsStore.botUserId = "bot";
  const live = liveSetupCheck({ scene, combat: null, users: game.users.contents });
  assert.equal(live.ok, false); assert.deepEqual(live.botReceiving.problems, ["noWebhook"]);
  const ans = game.users.contents.pop(); void ans;
  for (const k of ["enabled", "delivery", "webhookUrl", "botUserId", "botUserName"]) delete settingsStore[k];
  assert.equal(liveSetupCheck({ scene, combat: null, users: [pat] }).botReceiving, undefined);
});

test("0.9.3 #4 Test connection: says what it confirms, sends the world fields, and explains each failure", async () => {
  let seen = null;
  const ok = await testConnection({ url: "https://bot.example/hook", secret: "s3cret", header: "X-Key", worldInfo: worldInfo(), fetchImpl: async (u, o) => { seen = { u, o }; return { status: 200 }; } });
  assert.equal(ok.ok, true); assert.equal(ok.roundTrip, true);
  assert.match(ok.message, /received the test event and answered 2xx/); assert.match(ok.message, /does not prove the bot will reply/);
  const body = JSON.parse(seen.o.body);
  assert.equal(body.type, "testConnection"); assert.equal(body.ping, true); assert.equal(body.worldId, "pbtest"); assert.equal(body.systemId, "pirateborg"); assert.match(body.testId, /^test:/);
  assert.equal(seen.o.headers["X-Key"], "s3cret"); assert.equal(seen.o.headers["idempotency-key"], body.testId);
  const bad = await testConnection({ url: "https://bot.example/hook", fetchImpl: async () => ({ status: 401 }) });
  assert.equal(bad.ok, false); assert.equal(bad.roundTrip, false); assert.match(bad.error, /401/);
  const cors = await testConnection({ url: "https://bot.example/hook", secret: "s3cret", fetchImpl: async () => { throw new TypeError("Failed to fetch s3cret"); } });
  assert.equal(cors.ok, false); assert.match(cors.error, /CORS/); assert.ok(!cors.error.includes("s3cret"));
  const direct = await testConnection({ delivery: "direct", url: "" });
  assert.equal(direct.ok, false); assert.match(direct.error, /direct but the webhook URL is empty/);
  const relay = await testConnection({ delivery: "relay", url: "", botActive: true });
  assert.equal(relay.ok, true); assert.match(relay.message, /does not test the relay's webhook/);
  assert.equal((await testConnection({ delivery: "relay", url: "", botActive: false })).ok, false);
  assert.match(src("scripts/config-app.mjs"), /delivery, worldInfo: worldInfo\(\)/);
});

// ---------- 5. Foundry v14 level backgrounds ----------
function level(id, bg = null) { return { id, background: { src: bg }, async update(u) { this.background.src = u["background.src"]; } }; }
function v14Scene(levels) {
  const s = { levels: { contents: levels, get: (i) => levels.find(l => l.id === i) ?? null }, background: { src: null }, calls: [],
    get initialLevel() { return levels[0] ?? null; },
    async update(u) { this.calls.push(["scene.update", u]); },
    async updateEmbeddedDocuments(k, data) { this.calls.push(["updateEmbedded", k, data]); for (const d of data) levels.find(l => l.id === d._id).background.src = d.background.src; },
    async createEmbeddedDocuments(k, data, opts) { this.calls.push(["createEmbedded", k, data, opts]); const made = data.map(d => ({ ...level(d._id ?? "gen1"), name: d.name, background: { ...d.background } })); levels.push(...made); return made; } };
  return s;
}
test("0.9.3 #5 coreGeneration reads game.release.generation first, then the version string", () => {
  assert.equal(coreGeneration({ release: { generation: 14 }, version: "13.1" }), 14);
  assert.equal(coreGeneration({ version: "14.369" }), 14);
  assert.equal(coreGeneration({ data: { version: "13.351" } }), 13);
  assert.equal(coreGeneration({ release: { generation: "13" } }), 13);
  assert.equal(coreGeneration({}), null); assert.equal(coreGeneration(undefined), coreGeneration(globalThis.game));
  assert.equal(sceneUsesLevels({}, { release: { generation: 14 } }), true);
  assert.equal(sceneUsesLevels({ levels: { contents: [{}] } }, { release: { generation: 13 } }), false, "v13 never uses levels, even if a stray property exists");
  assert.equal(sceneUsesLevels({ levels: { contents: [{}] } }, {}), true, "unknown core: a levels collection counts");
  assert.equal(sceneUsesLevels({}, {}), false);
});

test("0.9.3 #5 v14: the background is written to the scene's level (defaultLevel0000), not to scene.background", async () => {
  const s = v14Scene([level("defaultLevel0000")]);
  const r = await setSceneBackground(s, "maps/cove.webp", { release: { generation: 14 } });
  assert.deepEqual(r, { via: "level", levelId: "defaultLevel0000", src: "maps/cove.webp" });
  assert.deepEqual(s.calls, [["updateEmbedded", "Level", [{ _id: "defaultLevel0000", background: { src: "maps/cove.webp" } }]]], "level path only; scene.update never called");
  assert.equal(sceneBackgroundSrc(s), "maps/cove.webp");
  // a scene with several levels: the initial (first) level is the map's background
  const two = v14Scene([level("L0"), level("L1")]); await setSceneBackground(two, "maps/a.webp", { release: { generation: 14 } });
  assert.equal(two.levels.contents[0].background.src, "maps/a.webp"); assert.equal(two.levels.contents[1].background.src, null);
  // changing an existing background
  const again = await setSceneBackground(s, "maps/new.webp", { release: { generation: 14 } }); assert.equal(again.src, "maps/new.webp");
});

test("0.9.3 #5 v14 scene with no level yet: a defaultLevel0000 level is created holding the background", async () => {
  const s = v14Scene([]);
  const r = await setSceneBackground(s, "maps/x.webp", { release: { generation: 14 } });
  assert.equal(r.via, "level"); assert.equal(r.created, true); assert.equal(r.levelId, "defaultLevel0000"); assert.equal(r.src, "maps/x.webp");
  assert.deepEqual(s.calls[0].slice(0, 2), ["createEmbedded", "Level"]); assert.equal(s.calls[0][2][0]._id, "defaultLevel0000"); assert.equal(s.calls[0][3].keepId, true);
  const noApi = { levels: { contents: [] } };
  await assert.rejects(() => setSceneBackground(noApi, "m.webp", { release: { generation: 14 } }), /no level/);
});

test("0.9.3 #5 older cores (v13) write scene.background.src; a value that does not stick is an error, not a grey map", async () => {
  const old = { background: { src: null }, async update(u) { this.background.src = u["background.src"]; } };
  assert.deepEqual(await setSceneBackground(old, "maps/b.webp", { release: { generation: 13 } }), { via: "scene", levelId: null, src: "maps/b.webp" });
  assert.deepEqual(await setSceneBackground({ ...old, background: { src: null }, async update(u) { this.background.src = u["background.src"]; } }, "maps/c.webp", { version: "13.351" }), { via: "scene", levelId: null, src: "maps/c.webp" });
  const swallowed = { background: { src: null }, async update() {} };
  await assert.rejects(() => setSceneBackground(swallowed, "maps/d.webp", { release: { generation: 13 } }), /did not save/);
  const lvlSwallow = v14Scene([level("defaultLevel0000")]); lvlSwallow.updateEmbeddedDocuments = async () => {};
  await assert.rejects(() => setSceneBackground(lvlSwallow, "maps/e.webp", { release: { generation: 14 } }), /did not save/);
  const viaLevelUpdate = { levels: { contents: [level("L9")] }, async update() {} };
  assert.equal((await setSceneBackground(viaLevelUpdate, "maps/f.webp", {})).via, "level", "no core number, levels present: level.update");
});

test("0.9.3 #5 setBackground and createScene commands: v14 writes the level, v13 writes the scene", async () => {
  const mk = (levels) => { const s = v14Scene(levels); s.id = "sc" + Math.random(); s.name = "Cove"; s.activate = async () => {}; return s; };
  const s14 = mk([level("defaultLevel0000")]);
  game.scenes.get = (id) => id === s14.id ? s14 : (id === "s1" ? scene : null); game.scenes.getName = () => null;
  const set = await run("setBackground", { sceneId: s14.id, src: "maps/set.webp" });
  assert.equal(set.ok, true, set.error); assert.equal(set.result.via, "level"); assert.equal(set.result.levelId, "defaultLevel0000"); assert.equal(s14.levels.contents[0].background.src, "maps/set.webp");
  assert.ok(!s14.calls.some(c => c[0] === "scene.update"));
  const created = mk([level("defaultLevel0000")]);
  globalThis.Scene = { create: async (d) => Object.assign(created, { name: d.name }) };
  const cs = await run("createScene", { name: "New Cove", src: "maps/new.webp", buildKey: "k1" });
  assert.equal(cs.ok, true, cs.error); assert.equal(cs.result.background.via, "level"); assert.equal(created.levels.contents[0].background.src, "maps/new.webp");
  // older core
  game.release = { generation: 13 };
  const old = { id: "old1", name: "Old", background: { src: null }, async update(u) { this.background.src = u["background.src"]; }, activate: async () => {} };
  game.scenes.get = (id) => id === "old1" ? old : null;
  const o = await run("setBackground", { sceneId: "old1", src: "maps/old.webp" });
  assert.equal(o.ok, true, o.error); assert.equal(o.result.via, "scene"); assert.equal(old.background.src, "maps/old.webp");
  globalThis.Scene = { create: async (d) => Object.assign(old, { name: d.name }) };
  const oc = await run("createScene", { name: "Old 2", src: "maps/old2.webp", buildKey: "k2" });
  assert.equal(oc.result.background.via, "scene");
  game.release = { generation: 14 }; game.scenes.get = (id) => id === "s1" ? scene : null; delete globalThis.Scene;
});

test("0.9.3 #5 no other add-on code writes a scene background", () => {
  for (const f of ["scripts/commands.mjs", "scripts/main.mjs", "scripts/features.mjs", "scripts/ship.mjs", "scripts/lib/testfight.mjs", "scripts/lib/spawn.mjs"]) {
    assert.doesNotMatch(src(f), /"background\.src"|background:\s*\{\s*src/, f);
  }
  assert.match(src("scripts/commands.mjs"), /setSceneBackground\(s, a\.src\)/); assert.match(src("scripts/commands.mjs"), /setSceneBackground\(scene, a\.src\)/);
});

// ---------- 6. multi-player safety ----------
const rollArgs = (user, actorName, extra = {}) => ({ user, actorName, stat: "agility", dr: 12, label: "Defend", ...extra });
test("0.9.3 #6 two players asked to roll in answer to the same message each get their own card (the roll lock is per player)", async () => {
  reset(); store.clear?.();
  const a = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:wake1" }));
  const b = await run("requestRoll", rollArgs("Sam", "Bart", { replyTo: "chat:wake1" }));
  assert.equal(a.ok, true, a.error); assert.equal(b.ok, true, b.error);
  assert.notEqual(a.result.requestId, b.result.requestId); assert.ok(!b.result.duplicate, "Sam's request is not collapsed into Pat's card");
  assert.equal(msgs.filter(m => m.flags[ID]?.rollRequest).length, 2);
  // a retried request for the same player and reply is still caught (a different label would be a new card without the lock)
  const retry = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:wake1", label: "Dodge it", dr: 15 }));
  assert.equal(retry.result.duplicate, true); assert.equal(retry.result.requestId, a.result.requestId);
  const again = await run("requestRoll", rollArgs("Sam", "Bart", { replyTo: "chat:wake1", label: "Dodge it", dr: 15 }));
  assert.equal(again.result.duplicate, true); assert.equal(again.result.requestId, b.result.requestId);
  // helpers
  assert.equal(rollReplyKey("chat:w"), "roll:chat:w"); assert.equal(rollReplyKey("chat:w", "p1:a1"), "roll:chat:w:p1:a1");
  assert.equal(rollScope({ userId: "p1", actorId: "a1" }), "p1:a1"); assert.equal(rollScope({}), "");
  const s = new DedupeStore(); recordRollReply(s, "chat:w", "r1", "m1", 1, "p1:a1");
  assert.equal(priorRollReply(s, "chat:w", "p2:a2"), null); assert.equal(priorRollReply(s, "chat:w", "p1:a1")?.requestId, "r1"); assert.equal(priorRollReply(s, "chat:w"), null);
});

test("0.9.3 #6 two identical requestRoll calls that arrive together make one card (requests are handled one at a time)", async () => {
  reset(); store.clear?.();
  const [x, y] = await Promise.all([run("requestRoll", rollArgs("Pat", "Tempus", { requestId: undefined })), run("requestRoll", rollArgs("Pat", "Tempus"))]);
  assert.equal(x.ok && y.ok, true);
  assert.equal(msgs.filter(m => m.flags[ID]?.rollRequest).length, 1);
  assert.equal([x, y].filter(r => r.result.duplicate).length, 1);
  // different players at the same moment: two cards
  reset(); store.clear?.();
  await Promise.all([run("requestRoll", rollArgs("Pat", "Tempus")), run("requestRoll", rollArgs("Sam", "Bart"))]);
  assert.equal(msgs.filter(m => m.flags[ID]?.rollRequest).length, 2);
});

const sheetRoll = (by, actor, { stat = "agility", total = 14 } = {}) => ({ id: "r" + Math.random(), timestamp: Date.now() + 5, author: by, speaker: { actor: actor.id }, flags: { pirateborg: { outcomes: [{ roll: { total } }] } },
  rolls: [{ formula: "1d20 + 1", total, dice: [{ faces: 20, results: [{ result: total - 1, active: true }] }] }] });
test("0.9.3 #6 two players roll at the same moment: each answers only their own card", async () => {
  reset(); store.clear?.();
  const a = await run("requestRoll", rollArgs("Pat", "Tempus")); const b = await run("requestRoll", rollArgs("Sam", "Bart"));
  const [x, y] = await Promise.all([F.onRollMessage(sheetRoll(pat, tempusW)), F.onRollMessage(sheetRoll(sam, barkW))]);
  assert.equal(x, true); assert.equal(y, true);
  const results = emitted.filter(e => e.type === "rollResult");
  assert.equal(results.length, 2);
  assert.equal(results.find(e => e.requestId === a.result.requestId).user, "Pat"); assert.equal(results.find(e => e.requestId === b.result.requestId).user, "Sam");
  assert.equal(F.pendingRequests().length, 0);
});

test("0.9.3 #6 one player with two open cards who rolls twice quickly answers both cards, not the same card twice", async () => {
  reset(); store.clear?.();
  const a = await run("requestRoll", rollArgs("Pat", "Tempus", { label: "Defend" }));
  const b = await run("requestRoll", rollArgs("Pat", "Tempus", { label: "Strike", dr: 14, stat: "strength" }));
  const noSpeaker = (n) => { const m = sheetRoll(pat, tempusW, { total: n }); m.speaker = {}; m.flags = {}; return m; };
  const [x, y] = await Promise.all([F.onRollMessage(noSpeaker(15)), F.onRollMessage(noSpeaker(9))]);
  assert.equal(x && y, true);
  const ids = emitted.filter(e => e.type === "rollResult").map(e => e.requestId).sort();
  assert.deepEqual(ids, [a.result.requestId, b.result.requestId].sort());
  assert.equal(F.pendingRequests().length, 0);
});

test("0.9.3 #6 a roll by player A never answers player B's card; cancelRoll by user only cancels that player's cards", async () => {
  reset(); store.clear?.();
  const a = await run("requestRoll", rollArgs("Pat", "Tempus")); const b = await run("requestRoll", rollArgs("Sam", "Bart"));
  assert.equal(await F.onRollMessage(sheetRoll(sam, tempusW)), false, "Sam rolling for Tempus is not Pat's roll");
  const c = await run("cancelRoll", { user: "Pat", label: "Defend" });
  assert.equal(c.ok, true, c.error);
  const open = F.pendingRequests(); assert.equal(open.length, 1); assert.equal(open[0].id, b.result.requestId);
  void a;
});

function mkCombat2() {
  const mk = (id, name, actor, owned) => ({ id, name, isNPC: !owned, actor, actorId: actor.id, tokenId: "t" + id, token: { id: "t" + id, actor }, players: owned ? [owned].flat() : [] });
  const t = mk("c1", "Tempus", tempusW, [pat, sam]); const bb = mk("c2", "Bart", barkW, sam); const rt = mk("c3", "Rat", ratBase, null);
  const turns = [rt, t, bb];
  const c = { id: "mc2", started: true, round: 1, turn: 0, combatants: { contents: turns }, turns, nextCalls: 0, get combatant() { return this.turns[this.turn]; },
    async nextTurn() { this.nextCalls++; this.turn = (this.turn + 1) % this.turns.length; } };
  combats.length = 0; combats.push(c); game.combat = c; return c;
}
test("0.9.3 #6 nextTurn lists every open roll when two players owe a roll, and moves on only after both are done", async () => {
  reset(); store.clear?.(); const c = mkCombat2();
  const a = await run("requestRoll", rollArgs("Pat", "Tempus")); const b = await run("requestRoll", rollArgs("Sam", "Bart"));
  const r = await run("nextTurn", { expect: { combatId: "mc2", round: 1, turn: 0 }, waitMs: 60 });
  assert.equal(r.code, 409); assert.equal(r.reason, "rollPending"); assert.deepEqual(r.pending.map(p => p.user).sort(), ["Pat", "Sam"]); assert.equal(c.nextCalls, 0);
  await F.onRollMessage(sheetRoll(pat, tempusW));
  const half = await run("nextTurn", { expect: { combatId: "mc2", round: 1, turn: 0 }, waitMs: 60 });
  assert.equal(half.code, 409); assert.deepEqual(half.pending.map(p => p.user), ["Sam"]);
  setTimeout(() => F.onRollMessage(sheetRoll(sam, barkW)), 40);
  const done = await run("nextTurn", { expect: { combatId: "mc2", round: 1, turn: 0 }, waitMs: 3000 });
  assert.equal(done.ok, true, JSON.stringify(done)); assert.equal(done.result.waitedForRoll, true); assert.equal(c.nextCalls, 1);
  void a; void b;
});

test("0.9.3 #6 two owners on one combatant: both get the turn ping, each hears their own recorded voice; non-owners get nothing", async () => {
  reset(); store.clear?.(); const c = mkCombat2(); c.turn = 1; // Tempus: owned by Pat and Sam
  const t = F.turnStatus(c);
  assert.deepEqual(t.ownerIds.sort(), ["p1", "p2"]); assert.match(F.turnStatus(c) && "x", /x/);
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ voiceTurnPrompt: true })[k], turnAudio: () => ({ ryan: "a/ryan.mp3", sonia: "a/sonia.mp3" }), voice: () => null, amLeader: () => true, log: () => {} });
  sockets.length = 0; await F.turnPrompt(c, { holdMs: 0 });
  const ping = sockets.find(s => s.type === "turnPing");
  assert.deepEqual([...ping.userIds].sort(), ["p1", "p2"]); assert.deepEqual([...ping.voiceUserIds].sort(), ["p1", "p2"]);
  assert.equal(pickAudioSrc(ping.audio, "sonia", ping.clip), "a/sonia.mp3"); assert.equal(pickAudioSrc(ping.audio, "ryan", ping.clip), "a/ryan.mp3");
  assert.equal(pickAudioSrc(ping.audio, "", ping.clip), "a/ryan.mp3", "Ryan stays the default");
  assert.equal(pickAudioSrc(ping.audio, "thomas", ping.clip), "a/ryan.mp3", "a missing voice falls back to Ryan");
  assert.equal(msgs.filter(m => m.flags[ID]?.turnPrompt).length, 1, "one chat line, not one per owner");
  assert.deepEqual(turnVoiceUserIds(["p1", "p2"], { turnVoiceUsers: "Sam", users: game.users }), ["p2"]);
  // a second prompt for the same turn never fires twice
  sockets.length = 0; await F.turnPrompt(c, { holdMs: 0 }); assert.equal(sockets.filter(s => s.type === "turnPing").length, 0);
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ rollRequestTimeoutMs: 600000, moraleAuto: true })[k], amLeader: () => true, dedupeOf: () => store, log: () => {} });
});

test("0.9.3 #6 two players chatting in one batch: both events go out in one batch, in order, each with its own author", () => {
  const ob = new Outbox();
  ob.enqueue({ eventId: "chat:a", type: "chat", author: "Pat", text: "I draw my cutlass" }, 100);
  ob.enqueue({ eventId: "chat:b", type: "chat", author: "Sam", text: "I duck behind the barrel" }, 150);
  ob.enqueue({ eventId: "rollreq:r1", type: "rollResult", actor: "Bart", user: "Sam" }, 160);
  const batch = ob.nextBatch(200, "pbtest");
  const p = buildPayload(batch, { worldInfo: worldInfo() });
  assert.deepEqual(p.events.map(e => e.author ?? e.user), ["Pat", "Sam", "Sam"]);
  assert.equal(new Set(p.events.map(e => e.eventId)).size, 3);
  assert.deepEqual(relayAutoAckIds(p.events), ["chat:a", "chat:b", "rollreq:r1"]);
  // a partial ack keeps the other player's event with its own batch id
  ob.ack(["chat:a"]); const rest = ob.nextBatch(1e9, "pbtest");
  assert.deepEqual(rest.events.map(e => e.eventId), ["chat:b", "rollreq:r1"]); assert.notEqual(rest.batchId, batch.batchId);
});

test("0.9.3 #6 the batcher: a second player's urgent message flushes the first player's waiting chat in the same batch", () => {
  let t = 0; const timers = new Map(); let seq = 0; const flushes = [];
  const b = new Batcher({ debounceMs: 1200, maxWaitMs: 3500, now: () => t, setT: (f, ms) => { timers.set(++seq, { at: t + ms, f }); return seq; }, clearT: (id) => timers.delete(id), onFlush: (o) => flushes.push({ ...o, at: t }) });
  b.push({ at: 0 }); t = 400; b.push({ at: 400 });
  assert.equal(flushes.length, 0); t = 800; b.push({ urgent: true, at: 800 });
  assert.equal(flushes.length, 1); assert.equal(flushes[0].first, 0, "the cap is measured from the first player's message");
  assert.equal(b.pending, false);
  t = 5000; b.push({ at: 5000 }); t = 5100; b.push({ at: 5100 }); t = 8600; b.check(); assert.equal(flushes.length, 2, "two players talking never hold the batch past the cap");
});

test("0.9.3 #6 leader election with a bot GM, a human GM and two players: exactly one leader, players never lead", () => {
  const timeoutMs = 45000; const now = 1_000_000;
  const clients = [{ id: "gm", isBot: false, isGM: true }, { id: "p1", isBot: false, isGM: false }, { id: "p2", isBot: false, isGM: false }]; // the bot is not logged in yet
  let state = null;
  for (const c of clients) {
    const d = decideLeader({ now, selfId: c.id, selfIsBot: c.isBot, selfIsGM: c.isGM, state, timeoutMs });
    if (c.isGM === false) assert.equal(d.action, "passive", c.id);
    if (d.action === "claim") state = applyHeartbeat(state, { userId: c.id, isBot: c.isBot, term: d.term }, now);
  }
  assert.equal(state.leaderId, "gm", "the human GM claimed first while no bot was there");
  const bot = decideLeader({ now: now + 1000, selfId: "bot", selfIsBot: true, selfIsGM: true, state, timeoutMs });
  assert.equal(bot.action, "claim"); state = applyHeartbeat(state, { userId: "bot", isBot: true, term: bot.term }, now + 1000);
  assert.equal(decideLeader({ now: now + 2000, selfId: "gm", selfIsBot: false, selfIsGM: true, state, timeoutMs }).action, "passive");
  assert.equal(decideLeader({ now: now + 2000, selfId: "p1", selfIsBot: false, selfIsGM: false, state, timeoutMs }).action, "passive");
  // two human GMs racing at the same term: the lower user id wins on every client
  const a = applyHeartbeat(null, { userId: "gmB", isBot: false, term: 1 }, 1); const merged = applyHeartbeat(a, { userId: "gmA", isBot: false, term: 1 }, 2);
  assert.equal(merged.leaderId, "gmA"); assert.equal(applyHeartbeat(merged, { userId: "gmB", isBot: false, term: 1 }, 3).leaderId, "gmA");
});

// ---------- 7. docs ----------
test("0.9.3 #7 setup guide exists, is linked from the README, the settings and the setup prompt window, and stays generic", () => {
  assert.equal(existsSync(new URL("../docs/SETUP.md", import.meta.url)), true);
  const guide = src("docs/SETUP.md");
  assert.match(SETUP_GUIDE_URL, /docs\/SETUP\.md$/); // 0.9.6: the copy bundled in the module
  assert.match(src("README.md"), /docs\/SETUP\.md/);
  assert.match(src("scripts/main.mjs"), /Setup guide: docs\/SETUP\.md in this module/);
  assert.match(src("scripts/setup-prompt-app.mjs"), /guideHref/); assert.match(src("scripts/config-app.mjs"), /guideHref/);
  assert.doesNotMatch(guide, /\(check/i, "no unresolved (check) marks");
  assert.doesNotMatch(guide, /Kev|Tempus|Lantern|dark-caribbean|pb-?test|PB Test|C&C Test|cc-test|192\.168\.|10\.\d+\.\d+\.\d+|Unraid|Pirate Borg GM|Helper/i, "no personal, world, player or network names");
  assert.match(guide, /Gate \(GateShark\)/); assert.match(guide, /1\.0/); assert.match(guide, /releases\/latest\/download\/module\.json/);
  assert.match(guide, /worldId/); assert.match(guide, /bot not receiving|Bot not receiving/i);
  assert.match(guide, /Test connection/);
});

test("0.9.3 #8 the bot setup prompt carries the version and documents the world fields and the not-receiving warning", () => {
  const p = src("docs/bot-setup-prompt.md");
  assert.match(p, /0\.9\.9/); assert.doesNotMatch(p, /v0\.9\.1|0\.9\.2\)|v0\.9\.[34]/);
  for (const w of ["worldId", "worldTitle", "systemId"]) assert.match(p, new RegExp(w));
  assert.match(p, /not receiving/i);
  const api = src("docs/BOT-API.md"); for (const w of ["worldId", "worldTitle", "systemId"]) assert.match(api, new RegExp(w));
});

test("0.9.3 manifest, package, changelog, README", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.9"); assert.equal(p.version, "0.9.9");
  assert.equal(m.manifest, "https://github.com/GateShark/ai-gm-bridge/releases/latest/download/module.json");
  assert.equal(m.download, "https://github.com/GateShark/ai-gm-bridge/releases/latest/download/module.zip");
  assert.equal(m.authors[0].name, "Gate (GateShark)");
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.9/);
  assert.match(src("README.md"), /v0\.9\.9/);
});

// ---------- 0.9.4 #2: the replyTo lock only holds while the card is open ----------
test("0.9.4 #2 same replyTo while the card is open returns it; after it is answered the same replyTo makes a new card", async () => {
  reset(); store.clear?.();
  const a1 = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:X" })); const b1 = await run("requestRoll", rollArgs("Sam", "Bart", { replyTo: "chat:X" }));
  const open = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:X", label: "Other", dr: 15 }));
  assert.equal(open.result.duplicate, true); assert.equal(open.result.requestId, a1.result.requestId); assert.equal(open.result.status, "pending");
  await F.onRollMessage(sheetRoll(pat, tempusW)); await F.onRollMessage(sheetRoll(sam, barkW));
  assert.equal(F.pendingRequests().length, 0);
  const a2 = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:X", label: "Follow-up attack", stat: "strength" }));
  const b2 = await run("requestRoll", rollArgs("Sam", "Bart", { replyTo: "chat:X", label: "Follow-up attack", stat: "strength" }));
  assert.equal(a2.ok && b2.ok, true, a2.error ?? b2.error);
  assert.ok(!a2.result.duplicate && !b2.result.duplicate, "new cards, not the old answers");
  assert.notEqual(a2.result.requestId, a1.result.requestId); assert.notEqual(b2.result.requestId, b1.result.requestId); assert.notEqual(a2.result.requestId, b2.result.requestId);
  assert.equal(a2.result.status, "pending");
  assert.equal(msgs.filter(m => m.flags[ID]?.rollRequest).length, 4);
  // the new card is now the locked one for that player (and the other player's lock is still separate)
  const again = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:X", label: "Follow-up attack", stat: "strength" }));
  assert.equal(again.result.duplicate, true); assert.equal(again.result.requestId, a2.result.requestId);
  await run("cancelRoll", { user: "Pat" }); await run("cancelRoll", { user: "Sam" }); // clear the card timers
});

test("0.9.4 #2 a cancelled card also lets the same replyTo ask again, and an explicit requestId still returns its card", async () => {
  reset(); store.clear?.();
  const a1 = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:Y", requestId: "rr-keep" }));
  await run("cancelRoll", { requestId: "rr-keep" });
  const a2 = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:Y", label: "Again" }));
  assert.ok(a2.ok && !a2.result.duplicate); assert.notEqual(a2.result.requestId, "rr-keep"); assert.equal(a2.result.status, "pending");
  const same = await run("requestRoll", rollArgs("Pat", "Tempus", { replyTo: "chat:Z", requestId: "rr-keep" }));
  assert.equal(same.result.duplicate, true); assert.equal(same.result.requestId, "rr-keep"); assert.equal(same.result.status, "cancelled");
  await run("cancelRoll", { user: "Pat" });
  assert.match(src("docs/BOT-API.md"), /same `replyTo` \*\*while that card is still open/); assert.match(src("docs/bot-setup-prompt.md"), /only while it is open/);
});

// ---------- 0.9.5 #1: sweep morale race ----------
import { isDown, creatureDown } from "../scripts/lib/morale.mjs";
import { moraleStale, beginSweep, endSweep, sweepActive, waitSweepSettled, resetSweep } from "../scripts/lib/moraleguard.mjs";
function fightWithStaleRows(hps = [4, 4, 4]) {
  // the combatant's own actor is a stale copy (full hp); the token's actor is the one a sweep really updates
  const cbs = ratToks.map((t, i) => { t.actor.system.attributes.hp.value = hps[i]; const stale = mkActor("n1", "Bilge Rat", { hp: 4, max: 4 });
    return { id: `cb${i}`, name: t.name, actor: stale, actorId: "n1", isNPC: true, tokenId: t.id, token: { id: t.id, actor: t.actor, disposition: -1 } }; });
  const combat = { id: "mc1", started: true, round: 1, turn: 0, combatants: { contents: cbs }, turns: cbs };
  combats.push(combat); game.combat = combat; return { combat, cbs };
}
test("0.9.5 #1 down is judged from the token's own actor too: a stale combatant row no longer makes a dead rat look alive", () => {
  reset(); const f = fightWithStaleRows();
  assert.equal(moraleStale({ combatId: "mc1" }), null, "all alive");
  for (const t of ratToks) t.actor.system.attributes.hp.value = 0;
  assert.equal(moraleStale({ combatId: "mc1" }), "noEnemiesLeft", "combat open, no defeated flag, stale rows: still no enemies left");
  assert.equal(creatureDown(f.cbs[0].actor, null), false); assert.equal(creatureDown(f.cbs[0].actor, ratToks[0]), true);
  assert.equal(isDown({ hp: 4, combatant: { actor: f.cbs[0].actor, token: { actor: ratToks[0].actor } } }), true);
  ratToks[1].actor.system.attributes.hp.value = 3; ratToks[1].actor.statuses = { has: (s) => s === "dead" };
  assert.equal(isDown({ hp: 3, combatant: { token: { actor: ratToks[1].actor } } }), true, "dead status counts");
  assert.equal(isDown({ hp: 4, combatant: { isDefeated: true } }), true);
});

test("0.9.5 #1 the race: the sweep ends the fight while the morale roll is out, rows are stale, combat stays open: no card is posted", async () => {
  reset(); const f = fightWithStaleRows();
  hooksDuringRoll = async () => { for (const t of ratToks) t.actor.system.attributes.hp.value = 0; }; // all three die during the roll; nothing else changes
  const r = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:firstEnemyDown1", reason: "firstEnemyDown" });
  hooksDuringRoll = async () => {};
  assert.equal(r.ok, true, r.error); assert.equal(cards.length, 0, "no Stands firm card for a dead rat"); assert.equal(msgs.length, 0);
  assert.ok(r.result.skipped === "noEnemiesLeft" || r.result.checked === 0);
  assert.equal(game.combat.started, true, "the combat was not ended and nothing ends it");
});

test("0.9.5 #1 a rat that is already down gets no card while a survivor still does (judged when the card would post)", async () => {
  reset(); fightWithStaleRows([0, 4, 4]); // rat 1 is dead on its token; the stale row says 4
  const r = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:firstEnemyDown2", reason: "firstEnemyDown" });
  assert.equal(r.ok, true, r.error); assert.equal(cards.length, 2, "cards for the two living rats only");
  // a rat that dies during the first rat's roll is dropped before its own card
  reset(); fightWithStaleRows([4, 4, 4]); let n = 0;
  hooksDuringRoll = async () => { if (n++ === 0) ratToks[2].actor.system.attributes.hp.value = 0; };
  const r2 = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc1:halfDown3", reason: "halfDown" });
  hooksDuringRoll = async () => {};
  assert.equal(r2.ok, true); assert.equal(cards.length, 2, "rats 1 and 2 only; rat 3 died before its card");
  // a manual call (no trigger) is unchanged
  reset(); fightWithStaleRows([4, 4, 4]); const m = await run("moraleCheck", { all: true, force: true }); assert.equal(m.result.checked, 3);
});

test("0.9.5 #1 sweep gate: a sweep that kills every enemy starts no morale run at all; a sweep with a survivor rolls for the survivor once, after it settled", async () => {
  reset(); resetSweep(); fightWithStaleRows(); let runs = 0;
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], log: () => {}, runMorale: (p) => { runs++; return run("moraleCheck", { all: true, trigger: p.eventId, reason: p.reason }); } });
  const prompt = { eventId: "moraleprompt:mc1:firstEnemyDown4", type: "moralePrompt", combatId: "mc1" };
  let pending = null;
  const first = ratToks[0].actor, orig = first.update.bind(first);
  first.update = async (d) => { await orig(d); pending = F.handleMoralePrompt(prompt); }; // the first death fires the prompt while the others still stand
  const ids = ratToks.map(t => t.id);
  const r = await run("applyDamage", { amount: 4, tokenIds: ids, sceneId: "s1" });
  assert.equal(r.ok, true, r.error); assert.equal(r.result.updated.length, 3);
  const out = await pending;
  assert.ok(out?.skipped, "skipped after the sweep settled"); assert.equal(runs, 0, "morale was never started"); assert.equal(cards.length, 0); assert.equal(emitted.filter(e => e.type === "moralePrompt").length, 0);
  assert.equal(sweepActive(Date.now() + 5000), false);
  // survivor case
  reset(); resetSweep(); fightWithStaleRows(); runs = 0; pending = null;
  const f2 = ratToks[0].actor, o2 = f2.update.bind(f2); f2.update = async (d) => { await o2(d); pending = F.handleMoralePrompt(prompt); };
  const r2 = await run("applyDamage", { amount: 4, tokenIds: [ratToks[0].id, ratToks[1].id], sceneId: "s1" });
  assert.equal(r2.ok, true, r2.error); await pending;
  assert.equal(runs, 1); assert.equal(cards.length, 1, "one card, for the rat that is still alive");
  assert.equal(emitted.filter(e => e.type === "moralePrompt").length, 1);
});

test("0.9.5 #1 sweep markers: active while sweeping, settle after a short quiet time, never wait forever, and single hits are not delayed", async () => {
  resetSweep(); assert.equal(sweepActive(), false);
  beginSweep(); assert.equal(sweepActive(), true); endSweep(1000); assert.equal(sweepActive(1200), true); assert.equal(sweepActive(1700), false);
  resetSweep(); beginSweep(); let t = 0; await waitSweepSettled({ now: () => t, sleep: async (ms) => { t += ms; }, capMs: 1000 }); assert.ok(t >= 1000 && t <= 1200, "capped"); resetSweep();
  const t0 = Date.now(); await waitSweepSettled(); assert.ok(Date.now() - t0 < 50, "no sweep, no wait");
  assert.match(src("scripts/commands.mjs"), /const sweeping = next\.updates\.length > 1; if \(sweeping\) beginSweep\(\)/);
});

// ---------- 0.9.6 #3: moraleCheck replies fast ----------
test("0.9.6 #3 the creatures roll at the same time, results keep the target order, and every card still posts", async () => {
  reset(); startFight().combat.id = "mc96x1";
  let live = 0, peak = 0;
  hooksDuringRoll = async () => { live++; peak = Math.max(peak, live); await sleep(120); live--; };
  const t0 = Date.now();
  const r = await run("moraleCheck", { all: true, force: true });
  const took = Date.now() - t0; hooksDuringRoll = async () => {};
  assert.equal(r.ok, true, r.error); assert.equal(r.result.checked, 3); assert.equal(cards.length, 3);
  assert.equal(peak, 3, "all three rolls were out at once"); assert.ok(took < 330, `parallel, not 3 x 120 ms (took ${took})`);
  assert.deepEqual(r.result.results.map(x => x.tokenId), ["tA", "tB", "tC"]);
  assert.equal(r.result.pending, undefined);
});

test("0.9.6 #3 slow rolls: a bot's moraleCheck answers pending at once, the cards post when the rolls finish, and asking again returns the finished run with no new cards", async () => {
  reset(); startFight().combat.id = "mc96x2";
  hooksDuringRoll = async () => { await sleep(250); };
  const t0 = Date.now();
  const r = await run("moraleCheck", { all: true, waitMs: 50, trigger: "bot:slow1" });
  assert.ok(Date.now() - t0 < 200, "answered long before the rolls finished");
  assert.equal(r.ok, true); assert.equal(r.result.pending, true); assert.equal(r.result.started, 3); assert.equal(r.result.checked, 0); assert.deepEqual(r.result.results, []);
  assert.match(r.result.note, /do not call moraleCheck again/i);
  assert.equal(cards.length, 0, "cards are not there yet");
  await sleep(450); hooksDuringRoll = async () => {};
  assert.equal(cards.length, 3, "the cards posted after the answer");
  const again = await run("moraleCheck", { all: true, waitMs: 5000, trigger: "bot:slow1" });
  assert.equal(again.ok, true); assert.equal(again.result.duplicate, true); assert.equal(again.result.checked, 3); assert.equal(cards.length, 3, "no second set of cards");
});

test("0.9.6 #3 a repeat call while the rolls are still running does not roll again or hang: it answers pending and the cards stay at one set", async () => {
  reset(); startFight().combat.id = "mc96x3";
  hooksDuringRoll = async () => { await sleep(250); };
  const first = await run("moraleCheck", { all: true, waitMs: 40, trigger: "bot:slow2" });
  const second = await run("moraleCheck", { all: true, waitMs: 40, trigger: "bot:slow2" });
  assert.equal(first.result.pending, true); assert.equal(second.result.pending, true);
  await sleep(700); hooksDuringRoll = async () => {};
  assert.equal(cards.length, 3, "one set of cards only");
});

test("0.9.6 #3 the automatic run (moraleprompt trigger) still waits for the full result", async () => {
  reset(); startFight().combat.id = "mc96x4";
  hooksDuringRoll = async () => { await sleep(80); };
  const r = await run("moraleCheck", { all: true, trigger: "moraleprompt:mc96x4:firstEnemyDown96", reason: "firstEnemyDown", waitMs: 10 });
  hooksDuringRoll = async () => {};
  assert.equal(r.ok, true); assert.equal(r.result.pending, undefined); assert.equal(r.result.checked, 3); assert.equal(cards.length, 3);
});

test("0.9.6 #3 a fast run and waitMs:0 return the full result as before", async () => {
  reset(); startFight().combat.id = "mc96x5";
  const r = await run("moraleCheck", { all: true });
  assert.equal(r.result.checked, 3); assert.equal(r.result.pending, undefined);
  store.clear?.(); const z = await run("moraleCheck", { all: true, waitMs: 0, force: true });
  assert.equal(z.result.checked, 3);
});
