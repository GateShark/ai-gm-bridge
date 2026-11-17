// 0.9.2: nextTurn roll guard, turn prompt hold, morale prompt after combat, bot setup prompt button. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { blockingRolls, waitUntilClear, describeBlockers, clampWait, ROLL_WAIT_MS, ROLL_WAIT_MAX_MS, PROMPT_HOLD_MS } from "../scripts/lib/turnguard.mjs";
import { moraleStale } from "../scripts/lib/moraleguard.mjs";
import { createMoralePromptTracker } from "../scripts/lib/moraleprompt.mjs";
import { splitPrompt, loadSetupPrompt, copyText, promptUrl, PROMPT_FILE, PLACEHOLDER_MARK } from "../scripts/lib/setupprompt.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ID = "ai-gm-bridge";
const msgs = [];
globalThis.fetch = async () => ({ ok: true });
globalThis.foundry = { utils: { randomID: () => "rnd", getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), escapeHTML: (s) => s } };
globalThis.ChatMessage = { async create(d) { const m = { id: "m" + (msgs.length + 1), ...d }; msgs.push(m); return m; }, getSpeaker: () => ({ alias: "GM" }) };
const userP = { id: "p1", name: "Pat", isGM: false, active: true };
const tempus = { id: "a1", name: "Tempus", type: "character", hasPlayerOwner: true, system: { attributes: { hp: { value: 5, max: 10 } } } };
const rat = { id: "r1", name: "Bilge Rat", type: "creature", system: { attributes: { hp: { value: 3, max: 3 } } } };
const combats = [];
const settingsStore = { autoUnpause: false };
globalThis.game = { system: { id: "pirateborg" }, world: { id: "pbtest" }, user: { id: "gm", isGM: true }, ready: true, paused: false,
  settings: { get: (m, k) => settingsStore[k], set: async (m, k, v) => { settingsStore[k] = v; } },
  users: { get: id => id === "p1" ? userP : null, find: f => [userP].find(f), contents: [userP], getName: n => n === "Pat" ? userP : null },
  actors: { get: id => [tempus, rat].find(a => a.id === id) ?? null, getName: n => [tempus, rat].find(a => a.name === n) ?? null },
  messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) },
  socket: { emit() {} }, combat: null, combats: { get contents() { return combats; }, get: id => combats.find(c => c.id === id) ?? null } };
const SHIP = await import("../scripts/ship.mjs");
SHIP.setLoader(async () => ({}));
const C = await import("../scripts/commands.mjs");
const F = await import("../scripts/features.mjs");
const emitted = [];
F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], amLeader: () => true, log: () => {} });
const ctx = { dedupe: null, persistNow: async () => {} };
const run = (name, args) => C.runCommand({ name, args }, ctx);

function mkCombat(id = "c1") {
  const ratCb = { id: "cb1", name: "Bilge Rat 1", isNPC: true, actor: rat, actorId: "r1", tokenId: "t1", token: { id: "t1", actor: rat, disposition: -1 } };
  const pcCb = { id: "cb2", name: "Tempus", isNPC: false, actor: tempus, actorId: "a1", tokenId: "t2", token: { id: "t2", actor: tempus } };
  const c = { id, started: true, round: 1, turn: 0, combatants: { contents: [ratCb, pcCb] }, turns: [ratCb, pcCb], nextCalls: 0,
    get combatant() { return this.turns[this.turn]; },
    async nextTurn() { this.nextCalls++; this.turn = (this.turn + 1) % this.turns.length; if (this.turn === 0) this.round++; } };
  combats.length = 0; combats.push(c); game.combat = c; return c;
}
let n = 0;
function addRoll(extra = {}) {
  const id = `rq${++n}`;
  const req = { id, userId: "p1", userName: "Pat", actorId: "a1", actorName: "Tempus", stat: "agility", dr: 12, label: "Defend", status: "pending", at: Date.now(), timeoutAt: Date.now() + 60000, expireAt: Date.now() + 600000, combatId: "c1", round: 1, turn: 0, ...extra };
  const m = { id: `card${n}`, flags: { [ID]: { rollRequest: req } } };
  msgs.push(m);
  return { req, set(patch) { m.flags[ID].rollRequest = { ...m.flags[ID].rollRequest, ...patch }; } };
}
const clearMsgs = () => { msgs.length = 0; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- turn guard helpers ----------
test("0.9.2 #1 blockingRolls: only open rolls tied to this combat block; expired, timed out, cancelled and done never do", () => {
  const now = 1_000_000;
  const mk = (o) => ({ id: "x", status: "pending", combatId: "c1", round: 1, turn: 0, timeoutAt: now + 5000, expireAt: now + 50000, actorId: "a1", ...o });
  const q = { combatId: "c1", round: 1, turn: 0, now };
  assert.equal(blockingRolls([mk({})], q).length, 1);
  assert.equal(blockingRolls([mk({ combatId: "c2" })], q).length, 0, "other combat");
  assert.equal(blockingRolls([mk({ status: "timeout" })], q).length, 0, "timed out: GM already notified");
  assert.equal(blockingRolls([mk({ status: "expired" })], q).length, 0);
  assert.equal(blockingRolls([mk({ status: "cancelled" })], q).length, 0);
  assert.equal(blockingRolls([mk({ status: "done" })], q).length, 0);
  assert.equal(blockingRolls([mk({ timeoutAt: now - 1 })], q).length, 0, "pending but past its own timeout (timer lagging)");
  assert.equal(blockingRolls([mk({ expireAt: now - 1, timeoutAt: undefined })], q).length, 0);
  // no combatId: counts only when it is for one of the combatants
  assert.equal(blockingRolls([mk({ combatId: undefined })], { ...q, actorIds: ["a1"] }).length, 1);
  assert.equal(blockingRolls([mk({ combatId: undefined })], { ...q, actorIds: ["zz"] }).length, 0);
  // prompt mode: only rolls from an earlier turn
  assert.equal(blockingRolls([mk({})], { ...q, mode: "prompt" }).length, 0, "asked this turn");
  assert.equal(blockingRolls([mk({ turn: 0 })], { ...q, turn: 1, mode: "prompt" }).length, 1, "asked last turn");
  assert.equal(blockingRolls([mk({ round: undefined, turn: undefined })], { ...q, turn: 1, mode: "prompt" }).length, 0);
  assert.deepEqual(describeBlockers([{ id: "r9", actorName: "Tempus", label: "Defend", dr: 12 }]), [{ requestId: "r9", actor: "Tempus", user: null, label: "Defend", dr: 12 }]);
  assert.equal(ROLL_WAIT_MS, 15000); assert.equal(PROMPT_HOLD_MS, 20000);
  assert.equal(clampWait(undefined), ROLL_WAIT_MS); assert.equal(clampWait(-5), 0); assert.equal(clampWait(9e9), ROLL_WAIT_MAX_MS); assert.equal(clampWait(250), 250);
});

test("0.9.2 #1 waitUntilClear returns as soon as the list empties, gives up at the cap, and can be aborted", async () => {
  let list = [1]; setTimeout(() => { list = []; }, 40);
  const r = await waitUntilClear(() => list, { ms: 2000, step: 10 });
  assert.deepEqual([r.blockers.length, r.waited, r.aborted], [0, true, false]);
  const t0 = Date.now();
  const cap = await waitUntilClear(() => [1], { ms: 60, step: 10 });
  assert.equal(cap.blockers.length, 1); assert.ok(Date.now() - t0 < 500);
  const ab = await waitUntilClear(() => [1], { ms: 2000, step: 10, stop: () => true });
  assert.equal(ab.aborted, true);
  assert.deepEqual((await waitUntilClear(() => [], { ms: 50 })), { blockers: [], waited: false, aborted: false });
  assert.equal((await waitUntilClear(() => { throw new Error("x"); }, { ms: 50 })).blockers.length, 0, "a failing check never blocks");
});

// ---------- nextTurn ----------
test("0.9.2 #1 nextTurn rejects with 409 rollPending while a defend roll is open, and does not move the turn", async () => {
  clearMsgs(); const c = mkCombat();
  addRoll();
  const t0 = Date.now();
  const r = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 }, waitMs: 80 });
  assert.equal(r.ok, false); assert.equal(r.code, 409); assert.equal(r.reason, "rollPending");
  assert.match(r.error, /roll pending/); assert.match(r.error, /force:true/);
  assert.equal(r.pending[0].actor, "Tempus"); assert.equal(r.pending[0].label, "Defend");
  assert.equal(c.turn, 0); assert.equal(c.nextCalls, 0, "turn did not move");
  assert.ok(Date.now() - t0 >= 70, "it waited first");
});

test("0.9.2 #1 nextTurn waits for the roll and then advances once it is answered", async () => {
  clearMsgs(); const c = mkCombat();
  const roll = addRoll();
  setTimeout(() => roll.set({ status: "done" }), 60);
  const r = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 }, waitMs: 3000 });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.waitedForRoll, true);
  assert.equal(c.turn, 1); assert.equal(c.nextCalls, 1);
});

test("0.9.2 #1 cancelled, timed-out and expired rolls do not block nextTurn", async () => {
  for (const patch of [{ status: "cancelled" }, { status: "timeout" }, { status: "expired" }, { timeoutAt: Date.now() - 1000 }]) {
    clearMsgs(); const c = mkCombat();
    addRoll(patch);
    const t0 = Date.now();
    const r = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 } });
    assert.equal(r.ok, true, JSON.stringify([patch, r])); assert.equal(c.nextCalls, 1);
    assert.equal(r.result.waitedForRoll, undefined); assert.ok(Date.now() - t0 < 300);
  }
});

test("0.9.2 #1 a roll that times out while nextTurn waits releases it", async () => {
  clearMsgs(); const c = mkCombat();
  const roll = addRoll({ timeoutAt: Date.now() + 5000 });
  setTimeout(() => roll.set({ status: "timeout" }), 50);
  const r = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 }, waitMs: 3000 });
  assert.equal(r.ok, true); assert.equal(c.nextCalls, 1);
});

test("0.9.2 #1 force:true skips the roll guard; rolls in another combat never block", async () => {
  clearMsgs(); const c = mkCombat();
  addRoll();
  const forced = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 }, force: true });
  assert.equal(forced.ok, true); assert.equal(forced.result.forced, true); assert.equal(c.nextCalls, 1);
  clearMsgs(); const c2 = mkCombat("c1"); c2.turn = 0;
  addRoll({ combatId: "other" });
  const r = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 0 } });
  assert.equal(r.ok, true);
});

test("0.9.2 #1 a stale expect is reported at once (no wait), and a missing expect is still a 400", async () => {
  clearMsgs(); const c = mkCombat();
  addRoll();
  const t0 = Date.now();
  const stale = await run("nextTurn", { expect: { combatId: "c1", round: 1, turn: 5 } });
  assert.equal(stale.code, 409); assert.match(stale.error, /stale/); assert.ok(Date.now() - t0 < 300, "no 15 s wait");
  const none = await run("nextTurn", {});
  assert.equal(none.code, 400);
  assert.equal(c.nextCalls, 0);
});

test("0.9.2 #1 the guard is wired in commands.mjs (after morale, before the lock) and force/waitMs are in the schema", () => {
  const cmds = src("scripts/commands.mjs");
  assert.match(cmds, /nextTurn: \{ schema: \{ expect: "object\?", force: "boolean\?", waitMs: "number\?" \}/);
  assert.match(cmds, /await awaitMorale\(key\);[\s\S]*waitUntilClear\(\(\) => F\.openCombatRolls\(preCombat\)[\s\S]*return combatLock\.run\(key/);
  assert.match(cmds, /reason: "rollPending"/);
});

// ---------- turn prompt hold ----------
const promptCount = () => msgs.filter(m => m.flags?.[ID]?.turnPrompt).length;
test("0.9.2 #1 the turn prompt waits for a roll left over from the previous turn, then fires once", async () => {
  clearMsgs(); const c = mkCombat(); c.turn = 1; // Tempus is up now; the defend roll was asked on the rat's turn (0)
  const roll = addRoll({ turn: 0 });
  setTimeout(() => roll.set({ status: "done" }), 80);
  const p = F.turnPrompt(c, { holdMs: 3000, step: 10 });
  await sleep(40); assert.equal(promptCount(), 0, "held while the defend roll is open");
  const t = await p;
  assert.equal(promptCount(), 1); assert.equal(t?.name, "Tempus");
});

test("0.9.2 #1 the turn prompt is not held by a roll asked on this same turn, and fires at once with no rolls", async () => {
  clearMsgs(); const c = mkCombat(); c.turn = 1; c.round = 2;
  addRoll({ round: 2, turn: 1 });
  await F.turnPrompt(c, { holdMs: 3000, step: 10 });
  assert.equal(promptCount(), 1);
  clearMsgs(); c.round = 3;
  await F.turnPrompt(c, { holdMs: 3000, step: 10 });
  assert.equal(promptCount(), 1);
});

test("0.9.2 #1 a held turn prompt is dropped if the turn moves on or the combat ends, and fires anyway after the hold cap", async () => {
  clearMsgs(); let c = mkCombat(); c.turn = 1; c.round = 4;
  addRoll({ round: 4, turn: 0 });
  const moved = F.turnPrompt(c, { holdMs: 3000, step: 10 });
  await sleep(30); c.turn = 0; c.round = 5;
  assert.equal(await moved, null); assert.equal(promptCount(), 0);
  clearMsgs(); c = mkCombat(); c.turn = 1; c.round = 6;
  addRoll({ round: 6, turn: 0 });
  const ended = F.turnPrompt(c, { holdMs: 3000, step: 10 });
  await sleep(30); combats.length = 0;
  assert.equal(await ended, null); assert.equal(promptCount(), 0);
  clearMsgs(); c = mkCombat(); c.turn = 1; c.round = 7;
  addRoll({ round: 7, turn: 0 });
  await F.turnPrompt(c, { holdMs: 60, step: 10 });
  assert.equal(promptCount(), 1, "a stuck roll cannot silence the prompt forever");
});

test("0.9.2 #1 the prompt is only sent from updateCombat (after the turn moved), and still behind the turnPrompts setting", () => {
  const main = src("scripts/main.mjs");
  assert.match(main, /Hooks\.on\("updateCombat"[\s\S]*if \(get\("turnPrompts"\)\) F\.turnPrompt\(c\)/);
  const feat = src("scripts/features.mjs");
  assert.match(feat, /export async function turnPrompt\(combat, \{ holdMs = PROMPT_HOLD_MS/);
  assert.match(feat, /upPrompt\(t, combat\)/);
});

// ---------- morale after combat ----------
function fight(hps) {
  const cbs = hps.map((hp, i) => { const a = { id: `e${i}`, name: `Rat ${i}`, system: { attributes: { hp: { value: hp, max: 3 } } } };
    return { id: `cb${i}`, name: a.name, actor: a, actorId: a.id, isNPC: true, tokenId: `tk${i}`, token: { id: `tk${i}`, actor: a, disposition: -1 } }; });
  const combat = { id: "mc1", started: true, round: 1, turn: 0, combatants: { contents: cbs } };
  return { combat, cbs };
}
test("0.9.2 #2 moraleStale: ended combat, started=false and no living enemy are stale; a live fight with a survivor is not", () => {
  const f = fight([0, 2]);
  const g = (combat) => ({ combats: { get: (id) => combat && combat.id === id ? combat : null }, users: { contents: [] } });
  const p = { combatId: "mc1" };
  assert.equal(moraleStale(p, g(f.combat)), null);
  assert.equal(moraleStale(p, g(null)), "combatEnded");
  assert.equal(moraleStale(p, g({ ...f.combat, started: false })), "combatEnded");
  const dead = fight([0, 0]);
  assert.equal(moraleStale(p, g(dead.combat)), "noEnemiesLeft");
  assert.equal(moraleStale({}, g(null)), null, "manual prompts without a combatId are never stale");
  assert.equal(moraleStale(p, null), null);
});

test("0.9.2 #2 the tracker sends no prompt when the last enemy falls, but still sends one when a survivor remains", () => {
  const solo = fight([3]); const t1 = createMoralePromptTracker();
  const a = solo.cbs[0].actor; t1.seed(a); a.system.attributes.hp.value = 0;
  assert.equal(t1.observe(a, { combat: solo.combat, users: [] }), null, "single enemy dead: nobody to check");
  const sweep = fight([3, 3, 3]); const t2 = createMoralePromptTracker();
  for (const cb of sweep.cbs) t2.seed(cb.actor);
  const seen = [];
  for (const cb of sweep.cbs) { cb.actor.system.attributes.hp.value = 0; seen.push(t2.observe(cb.actor, { combat: sweep.combat, users: [] })); }
  assert.equal(seen[0]?.type, "moralePrompt", "first kill of three: prompt");
  assert.equal(seen[1]?.reason, "halfDown");
  assert.equal(seen[2], null, "the kill that leaves nobody alive: no prompt");
});

test("0.9.2 #2 handleMoralePrompt drops a prompt whose combat already ended (endCombat ran first) and never rolls or emits", async () => {
  clearMsgs(); emitted.length = 0; combats.length = 0;
  let rolled = 0;
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], runMorale: async () => { rolled++; return { ok: true, result: { results: [] } }; }, log: () => {} });
  const early = await F.handleMoralePrompt({ eventId: "mp1", type: "moralePrompt", combatId: "gone", reason: "firstEnemyDown" });
  assert.deepEqual(early, { ok: true, skipped: "combatEnded" });
  assert.equal(rolled, 0); assert.equal(emitted.length, 0);
  // moraleAuto off takes the same guard
  F.initFeatures({ get: (k) => ({ moraleAuto: false })[k] });
  F.handleMoralePrompt({ eventId: "mp2", type: "moralePrompt", combatId: "gone" });
  assert.equal(emitted.length, 0);
});

test("0.9.2 #2 a morale run that finishes after the combat ended is not emitted; a normal one still is; manual prompts are untouched", async () => {
  clearMsgs(); emitted.length = 0; combats.length = 0;
  const f = fight([0, 2]); combats.push(f.combat);
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], log: () => {},
    runMorale: async () => { await sleep(20); combats.length = 0; return { ok: true, result: { results: [{ name: "Rat 1", result: "stands" }] } }; } });
  const late = await F.handleMoralePrompt({ eventId: "mp3", type: "moralePrompt", combatId: "mc1" });
  assert.equal(late.skipped, "combatEnded"); assert.equal(emitted.length, 0);
  combats.push(f.combat);
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], log: () => {}, runMorale: async () => ({ ok: true, result: { results: [{ name: "Rat 1", result: "stands" }] } }) });
  await F.handleMoralePrompt({ eventId: "mp4", type: "moralePrompt", combatId: "mc1" });
  assert.equal(emitted.length, 1); assert.equal(emitted[0].resolved, true);
  await F.handleMoralePrompt({ eventId: "mp5", type: "moralePrompt" });
  assert.equal(emitted.length, 2, "no combatId: behaves as before");
  combats.length = 0;
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: (k) => ({ moraleAuto: true })[k], amLeader: () => true, log: () => {} });
});

test("0.9.2 #2 deleteCombat also drops a moralePrompt still queued for that combat", () => {
  const main = src("scripts/main.mjs");
  assert.match(main, /function dropMoralePrompts\(c\)[\s\S]*dropWhere\(e => e\.type === "moralePrompt" && e\.combatId === c\?\.id\)/);
  assert.match(main, /F\.onCombatDelete\(c\); dropMoralePrompts\(c\);/);
});

// ---------- bot setup prompt ----------
test("0.9.2 #3 splitPrompt separates the human note from the bot block and spots the placeholder mark", () => {
  const p = splitPrompt("# T\nfor you\n\n---\n\n# Bot\nbody\r\n");
  assert.equal(p.intro, "# T\nfor you"); assert.equal(p.body, "# Bot\nbody"); assert.equal(p.placeholder, false);
  assert.equal(splitPrompt("no divider").body, "no divider");
  assert.equal(splitPrompt(`x\n---\n<!-- ${PLACEHOLDER_MARK} -->`).placeholder, true);
  assert.equal(splitPrompt("a --- b\n---\nc").body, "c", "only a line that is just --- divides");
});

test("0.9.2 #3 loadSetupPrompt fetches the packaged file by module path; copyText uses the clipboard, then the select-and-copy fallback", async () => {
  assert.equal(promptUrl("ai-gm-bridge", (p) => `/r/${p}`), `/r/modules/ai-gm-bridge/${PROMPT_FILE}`);
  let asked;
  const p = await loadSetupPrompt({ url: "/x", fetchImpl: async (u) => { asked = u; return { ok: true, text: async () => "intro\n---\nbody" }; } });
  assert.equal(asked, "/x"); assert.equal(p.body, "body");
  await assert.rejects(loadSetupPrompt({ url: "/x", fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/);
  let wrote; assert.equal(await copyText("hi", { clipboard: { writeText: async (t) => { wrote = t; } } }), true); assert.equal(wrote, "hi");
  const ta = { focus() {}, select() { this.sel = true; } };
  assert.equal(await copyText("hi", { clipboard: { writeText: async () => { throw new Error("denied"); } }, textarea: ta, doc: { execCommand: (c) => c === "copy" } }), true);
  assert.equal(ta.sel, true);
  assert.equal(await copyText("hi", { clipboard: null, textarea: ta, doc: { execCommand: () => false } }), false);
});

test("0.9.2 #3 the setup prompt ships in the module, is GM-only, and carries no personal details", () => {
  assert.ok(existsSync(new URL("../docs/bot-setup-prompt.md", import.meta.url)));
  const text = src("docs/bot-setup-prompt.md");
  const { intro, body } = splitPrompt(text);
  assert.ok(intro.length > 50 && body.length > 2000);
  assert.match(text, /0\.9\.2/); assert.doesNotMatch(text, /0\.9\.1/);
  assert.match(body, /rollPending/); assert.match(body, /force: true/);
  assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, "no IP addresses");
  assert.doesNotMatch(text, /\/mnt\/|\/workspace|\/home\/|[A-Z]:\\|dark-caribbean|Lantern|unraid/i);
  assert.doesNotMatch(text, /GateShark|Kevin|Kev\b|Tempus/);
  const main = src("scripts/main.mjs");
  assert.match(main, /registerMenu\(ID, "setupPrompt", \{[^}]*label: "Copy bot setup prompt"[^}]*restricted: true \}/);
  const app = src("scripts/setup-prompt-app.mjs");
  assert.match(app, /game\.user\?\.isGM/); assert.match(app, /readonly data-aigm-prompt/); assert.match(app, /copyText\(/);
});

// ---------- release ----------
test("0.9.2 version, beta label, credit, manifest pattern, Ryan default", async () => {
  const mod = JSON.parse(src("module.json"));
  assert.equal(mod.version, "0.9.3"); assert.equal(mod.id, "ai-gm-bridge");
  assert.equal(JSON.parse(src("package.json")).version, "0.9.3");
  assert.equal(mod.authors[0].name, "Gate (GateShark)");
  assert.match(mod.manifest, /\/releases\/latest\/download\/module\.json$/); assert.match(mod.download, /\/releases\/latest\/download\/module\.zip$/);
  assert.match(src("CHANGELOG.md"), /^# Changelog\n\n## 0\.9\.3\n/);
  assert.match(src("README.md"), /v0\.9\.3/);
  const { DEFAULT_TTS_VOICE } = await import("../scripts/lib/voices.mjs");
  assert.equal(DEFAULT_TTS_VOICE, "en-GB-RyanNeural");
});
