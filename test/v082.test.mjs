// 0.8.2: #13 unlinked-token stat writes, #14 "GM is thinking…" indicator.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { targetActor } from "../scripts/lib/target.mjs";
import { ThinkingIndicator, shouldShowThinking, THINKING_ID } from "../scripts/lib/thinking.mjs";

const mkActor = (id, hp) => ({ id, type: "character", system: { attributes: { hp: { value: hp, max: 10 } } }, updates: [],
  async update(u) { this.updates.push(u); for (const [k, v] of Object.entries(u)) { const ks = k.split("."); let o = this; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)] = v; } } });
const base = mkActor("A1", 10); const synth = mkActor("A1", 6); const linkedBase = mkActor("L1", 8);
const unlinked = { id: "T1", name: "Tempus", actorLink: false, actor: synth, baseActor: base };
const linked = { id: "T2", name: "Linked", actorLink: true, actor: linkedBase, baseActor: linkedBase };
const getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.foundry = { utils: { getProperty, escapeHTML: s => s }, audio: { AudioHelper: { play: async () => ({}) } } };
const scene = { id: "S", tokens: { get: (id) => [unlinked, linked].find(t => t.id === id), find: (f) => [unlinked, linked].find(f) } };
globalThis.canvas = { scene };
globalThis.game = { system: { id: "pirateborg" }, audio: { locked: false }, socket: { emit() {} }, i18n: {}, scenes: { get: () => scene, active: scene },
  settings: { get: () => "system.hp.value" }, actors: { get: (id) => ({ A1: base, L1: linkedBase })[id], getName: (n) => n === "Tempus" ? base : null } };
const { runCommand } = await import("../scripts/commands.mjs");
const ctx = { dedupe: null, persistNow: async () => {}, ack: async () => {} };

test("#13 targetActor: unlinked token -> token.actor, linked -> base, none -> base", () => {
  assert.equal(targetActor({ token: unlinked, baseActor: base }).actor, synth);
  assert.equal(targetActor({ token: unlinked }).via, "token");
  assert.equal(targetActor({ token: linked }).actor, linkedBase);
  assert.equal(targetActor({ baseActor: base }).actor, base);
  assert.equal(targetActor({}), null);
});
test("#13 setHP on an unlinked token writes the token's actor, not the base actor", async () => {
  const r = await runCommand({ name: "setHP", args: { tokenName: "Tempus", delta: -2 } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.via, "token"); assert.equal(r.result.before, 6); assert.equal(r.result.after, 4);
  assert.equal(synth.system.attributes.hp.value, 4); assert.equal(base.updates.length, 0); assert.equal(base.system.attributes.hp.value, 10);
});
test("#13 setHP without a token still writes the base actor; linked token writes base", async () => {
  let r = await runCommand({ name: "setHP", args: { actorName: "Tempus", value: 9 } }, ctx);
  assert.equal(r.ok, true); assert.equal(base.system.attributes.hp.value, 9); assert.equal(r.result.tokenId, undefined);
  r = await runCommand({ name: "setHP", args: { tokenId: "T2", value: 7 } }, ctx);
  assert.equal(r.ok, true); assert.equal(linkedBase.system.attributes.hp.value, 7); assert.equal(r.result.via, "actor");
});
test("#13 unknown token -> 404; setResource/getResources accept a token", async () => {
  assert.equal((await runCommand({ name: "setHP", args: { tokenName: "Nope", value: 1 } }, ctx)).code, 404);
  const src = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  for (const c of ["setResource", "getResources", "shipDamage", "getShip", "rest"]) assert.match(src, new RegExp(`${c}: \\{ schema: \\{[^}]*\\.\\.\\.TOK`));
});

function fakeDoc() {
  const els = new Map();
  return { els, body: { appendChild: (e) => els.set(e.id, e) }, getElementById: (id) => els.get(id) ?? null,
    createElement: () => { const e = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { els.delete(this.id); } }; return e; } };
}
test("#14 shouldShowThinking: only first send of player chat/roll batches", () => {
  assert.equal(shouldShowThinking([{ type: "chat" }], 1), true);
  assert.equal(shouldShowThinking([{ type: "rollResult" }], 1), true);
  assert.equal(shouldShowThinking([{ type: "chat" }], 2), false);
  assert.equal(shouldShowThinking([{ type: "turn" }, { type: "debug" }], 1), false);
});
test("#14 indicator shows one pill, hides, and times out", () => {
  const doc = fakeDoc(); let fire = null, cleared = 0;
  const t = new ThinkingIndicator({ doc, label: () => "Thinking!", setT: (f, ms) => { fire = { f, ms }; return 1; }, clearT: () => cleared++ });
  assert.equal(t.show(90000), true); assert.equal(doc.els.get(THINKING_ID).textContent, "Thinking!"); assert.equal(fire.ms, 90000);
  t.show(5000); assert.equal(doc.els.size, 1); assert.equal(fire.ms, 5000); assert.ok(cleared >= 1);
  assert.equal(t.hide(), true); assert.equal(t.visible, false); assert.equal(t.hide(), false);
  t.show(1000); fire.f(); assert.equal(t.visible, false);
  fire = null; t.show(0); assert.equal(fire, null); assert.equal(t.visible, true);
});
test("#14 wiring: settings, socket, clear on bot message/voice/command, localized label", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /reg\("thinkingIndicator", Boolean, true\)/); assert.match(m, /reg\("thinkingTimeoutMs", Number, 90000\)/);
  assert.match(m, /data\.type === "thinking"/); assert.match(m, /shouldShowThinking\(batch\.events, batch\.attempt\)/);
  assert.match(m, /thinkingOff\(\{ broadcast: true \}\)/); assert.match(m, /isBot\(msg\.author/); assert.match(m, /"voice"\) \{ thinking\.hide\(\)/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  assert.equal(typeof en.AIGM.thinking, "string"); assert.ok(en.AIGM.settings.thinkingIndicator.name);
});
