// 0.8.21: morale wait/empty results, nextTurn expect-first, earlier reconnecting, replay click guard. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DedupeStore } from "../scripts/lib/dedupe.mjs";
import { isLinkFresh } from "../scripts/lib/presence.mjs";
import { deriveGmStatus } from "../scripts/lib/gmstatus.mjs";
import { offlinePhase, DEFAULT_OFFLINE_NOTIFY_MS } from "../scripts/lib/offline.mjs";
import { enhanceVoiceMessage, hideNativeAudio } from "../scripts/lib/voiceui.mjs";

const msgs = [];
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd", getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; }, getSpeaker: () => ({ alias: "GM" }) };
const userP = { id: "p1", name: "Pat", isGM: false, active: true };
const tempus = { id: "a1", name: "Tempus", type: "character", system: { attributes: { hp: { value: 5, max: 10 } } }, getRollData() { return {}; } };
const settingsStore = {};
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true,
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP], getName: n => n === "Pat" ? userP : null },
  actors: { get: id => id === "a1" ? tempus : null, getName: n => n === "Tempus" ? tempus : null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) },
  socket: { emit() {} }, combat: null, combats: { get: () => null } };
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async () => { throw new Error("ship loader should not run in empty-morale tests"); });
const C = await import("../scripts/commands.mjs");
const { runCommand, MORALE_WAIT_MS } = C;
const F = await import("../scripts/features.mjs");
const store = new DedupeStore();
const emitted = [];
F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], amLeader: () => true, dedupeOf: () => store });
const ctxOf = (extra = {}) => ({ dedupe: store, persistNow: async () => {}, ...extra });

function deadEnemyFight() {
  const tok = { id: "tL", name: "Drowned Leader", disposition: -1, actorId: "acoly" };
  const actor = { id: "acoly", name: tok.name, type: "creature", token: tok, system: { attributes: { hp: { value: 0, max: 8 }, morale: 7 } } };
  tok.actor = actor;
  const pc = { id: "cP", name: "Tempus", isNPC: false, actor: tempus, tokenId: "tP", token: { id: "tP" } };
  const enemy = { id: "c1", name: tok.name, isNPC: true, actor, tokenId: tok.id, token: tok, actorId: "acoly" };
  return { combat: { id: "dead1", started: true, round: 1, turn: 1, combatants: { contents: [pc, enemy] }, combatant: enemy }, tokens: [tok] };
}

test("0.8.21 #1 awaitMorale waits for the real job and any job that replaces it, with a 30 s cap", async () => {
  assert.equal(MORALE_WAIT_MS, 30000);
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /MORALE_WAIT_MS = 30000/);
  assert.doesNotMatch(cmds, /awaitMorale\(combatId, ms = 8000\)/);
  let done = false;
  C.moraleRuns.set("cWait", new Promise(r => setTimeout(() => { done = true; r(); }, 25)));
  assert.equal(await C.awaitMorale("cWait"), true);
  assert.equal(done, true);
  // a follow-up job that appears as the first one finishes is also awaited
  const order = [];
  let finishFirst;
  const first = new Promise(r => { finishFirst = r; });
  C.moraleRuns.set("cChain", first.then(() => {
    order.push("a");
    const second = new Promise(r => setTimeout(() => { order.push("b"); r(); }, 15));
    C.moraleRuns.set("cChain", second);
  }));
  setTimeout(() => finishFirst(), 10);
  assert.equal(await C.awaitMorale("cChain"), true);
  assert.deepEqual(order, ["a", "b"]);
  // safety cap: do not hang on a job that never settles
  C.moraleRuns.set("cCap", new Promise(() => {}));
  const t0 = Date.now();
  assert.equal(await C.awaitMorale("cCap", 30), true);
  assert.ok(Date.now() - t0 < 200, "cap returned promptly");
  C.moraleRuns.delete("cCap");
});

test("0.8.21 #2 moraleCheck with no living enemies returns resolved empty results, not an error", async () => {
  const f = deadEnemyFight();
  game.combat = f.combat;
  globalThis.canvas = { scene: { tokens: { get: (id) => f.tokens.find(t => t.id === id) ?? null, find: (fn) => f.tokens.find(fn) ?? null } } };
  const r = await runCommand({ name: "moraleCheck", args: { all: true, trigger: "moraleprompt:dead1:firstEnemyDown+halfDown" } }, ctxOf());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.results, []);
  assert.equal(r.result.checked, 0);
  const again = await runCommand({ name: "moraleCheck", args: { all: true, trigger: "moraleprompt:dead1:firstEnemyDown+halfDown" } }, ctxOf());
  assert.equal(again.ok, true);
  assert.equal(again.result.duplicate, true);
  emitted.length = 0;
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], runMorale: async (p) => runCommand({ name: "moraleCheck", args: { all: true, trigger: p.eventId } }, ctxOf()) });
  const ev = await F.handleMoralePrompt({ eventId: "moraleprompt:dead1:firstEnemyDown+halfDown", type: "moralePrompt", reason: "firstEnemyDown" });
  assert.equal(ev.ok, true);
  assert.equal(emitted[0].resolved, true);
  assert.deepEqual(emitted[0].results, []);
  assert.equal(emitted[0].error, undefined);
  game.combat = null;
});

test("0.8.21 #3 nextTurn without expect rejects immediately, not after the morale wait", async () => {
  C.moraleRuns.set("none", new Promise(() => {})); // would hang or hit the 30 s cap if we waited
  const t0 = Date.now();
  const r = await runCommand({ name: "nextTurn", args: {} }, ctxOf());
  const dt = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.code, 400);
  assert.match(r.error, /expect/);
  assert.ok(dt < 200, `rejected in ${dt}ms`);
  C.moraleRuns.delete("none");
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /if \(pre && pre\.code === 400\) return pre;/);
});

test("0.8.21 #4 pill goes to reconnecting on the first missed heartbeat, not after ~60 s of listening", () => {
  const now = 10_000_000;
  // leftover nonce is still inside offlineAfterMs, but the bot user is already inactive
  assert.equal(isLinkFresh({ selfIsBot: false, botActive: false, lastConfirmed: now - 5_000, now, offlineAfterMs: 60_000 }), false);
  assert.equal(isLinkFresh({ selfIsBot: false, botActive: true, lastConfirmed: now - 5_000, now, offlineAfterMs: 60_000 }), true);
  assert.equal(isLinkFresh({ selfIsBot: true, botActive: false, lastConfirmed: now - 5_000, now, offlineAfterMs: 60_000 }), true, "bot page still uses the nonce");
  assert.equal(deriveGmStatus({ enabled: true, botActive: false, lastConfirmed: now - 5_000, now, offlineAfterMs: 60_000 }), "offline");
  assert.equal(offlinePhase({ fresh: false, lastSeen: now - 5_000, now, notifyAfterMs: DEFAULT_OFFLINE_NOTIFY_MS }), "reconnecting");
  assert.equal(offlinePhase({ fresh: false, lastSeen: now - DEFAULT_OFFLINE_NOTIFY_MS, now }), "offline");
});

test("0.8.21 #5 replay button is disabled while its clip is queued or playing, then re-enabled", async () => {
  const css = readFileSync(new URL("../scripts/lib/styles.mjs", import.meta.url), "utf8");
  assert.match(css, /\.aigm-voice-replay:disabled/);
  const msg = { id: "mReplay", content: "Aye.", flags: { "ai-gm-bridge": { audio: { sonia: "a/sonia.mp3" } } } };
  const clicks = [];
  let finish;
  const playing = new Promise(r => { finish = r; });
  const btn = { type: "", className: "", dataset: {}, title: "", textContent: "", disabled: false, fn: null,
    setAttribute() {}, addEventListener(t, f) { this.fn = f; } };
  const audio = { attrs: { controls: "" }, hidden: false, removeAttribute(k) { delete this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute: () => "a/ryan.mp3", pause() {},
    parentNode: { insertBefore(n) { audio.btn = n; }, childNodes: [] } };
  hideNativeAudio(audio);
  const root = { querySelector: (q) => q === "audio[src]" ? audio : (q === "[data-aigm-replay]" ? audio.btn : null),
    ownerDocument: { createElement: () => btn } };
  enhanceVoiceMessage(msg, root, { slug: "sonia", replay: (src) => { clicks.push(src); return playing; } });
  assert.equal(btn.disabled, false);
  btn.fn({ preventDefault() {}, stopPropagation() {} });
  assert.equal(btn.disabled, true);
  btn.fn({ preventDefault() {}, stopPropagation() {} }); // spam click ignored
  assert.deepEqual(clicks, ["a/sonia.mp3"]);
  finish();
  await playing;
  await new Promise(r => setImmediate(r));
  assert.equal(btn.disabled, false);
  btn.fn({ preventDefault() {}, stopPropagation() {} });
  assert.equal(btn.disabled, true);
  assert.deepEqual(clicks, ["a/sonia.mp3", "a/sonia.mp3"]);
});

test("0.8.21 release metadata is beta", () => {
  const mod = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(mod.version, "0.8.21");
  assert.equal(mod.id, "ai-gm-bridge");
  assert.equal(mod.title, "AI GM Pirate Borg");
  assert.deepEqual(mod.authors.map(a => a.name), ["Gate (GateShark)"]);
  assert.match(mod.manifest, /releases\/latest\/download\/module\.json$/);
  assert.match(mod.download, /releases\/latest\/download\/module\.zip$/);
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.21");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /v0\.8\.21/);
  assert.match(readme, /\*\*Beta:\*\*/);
  assert.match(readme, /\*\*beta\*\* build/);
  assert.doesNotMatch(readme, /\b[Aa]lpha\b/);
  assert.doesNotMatch(readme, /Kevin|Allen|\bKev\b|@gmail\.com|\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.match(log, /## 0\.8\.21/);
  assert.match(log, /Beta release\. Credit: Gate \(GateShark\)/);
  const api = readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8");
  assert.match(api, /v0\.8\.21/);
  assert.match(api, /30 s safety cap/);
});
