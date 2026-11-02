import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml, shortHash, buildSections, renderContext, ContextCache, journalIncluded, contextAllowed } from "../scripts/lib/context.mjs";
import { evaluate } from "../scripts/lib/rollreq.mjs";
import { collectData, getContext, cache } from "../scripts/context.mjs";

test("rollResult: success/crit/fumble always booleans", () => {
  for (const r of [evaluate({ total: 12, natural: 10, dr: 12 }), evaluate({ total: 3, natural: 1, dr: 2 }), evaluate({ total: 25, natural: 20, dr: 30 }),
    evaluate({ total: undefined, natural: null, dr: 12 }), evaluate({ total: 14, natural: undefined, dr: undefined })])
    for (const k of ["success", "crit", "fumble"]) assert.equal(typeof r[k], "boolean", k);
  assert.equal(evaluate({ total: 3, natural: 1, dr: 2 }).success, false); assert.equal(evaluate({ total: 5, natural: 20, dr: 30 }).success, true);
});
test("rollResult event forces booleans", () => assert.match(readFileSync("scripts/features.mjs", "utf8"), /success: result\.success === true, crit: result\.crit === true, fumble: result\.fumble === true/));

test("stripHtml", () => assert.equal(stripHtml("<p>The <b>key</b> is @UUID[x]{under the altar}&amp; more</p><script>bad()</script>"), "The key is under the altar& more"));
test("shortHash stable and short", () => { assert.equal(shortHash("abc"), shortHash("abc")); assert.notEqual(shortHash("abc"), shortHash("abd")); assert.ok(shortHash("x".repeat(9999)).length <= 7); });
test("journalIncluded by entry or ancestor folder", () => {
  const e = { id: "E1", name: "Villain", folder: { id: "F2", name: "Act 1", folder: { id: "F1", name: "GM Secrets" } } };
  assert.ok(journalIncluded(e, ["gm secrets"])); assert.ok(journalIncluded(e, ["E1"])); assert.ok(!journalIncluded(e, ["Players"])); assert.ok(!journalIncluded(e, []));
});
test("sections truncate to maxChars", () => {
  const s = buildSections({ scene: { name: "Cove", notes: "x".repeat(5000) }, journals: [{ name: "J", pages: [{ name: "P", html: "<p>" + "y".repeat(5000) + "</p>" }] }] }, { maxChars: 600 });
  assert.ok(renderContext(s, 600).length <= 600);
});

// Fake Foundry world.
const coll = (arr) => ({ contents: arr, get: (k) => arr.find(d => d.id === k), getName: (n) => arr.find(d => d.name === n), find: (f) => arr.find(f) });
const page = (id, name, html, type = "text") => ({ id, name, type, text: { content: html } });
function world(user) {
  const secret = { id: "J1", name: "Secrets", folder: { id: "F1", name: "GM Only" }, pages: coll([page("p1", "Twist", "<p>The captain is a ghost</p>")]) };
  const sceneJ = { id: "J2", name: "Cove notes", pages: coll([page("p2", "Cove", "<p>Smugglers hide in the cave</p>")]) };
  const other = { id: "J3", name: "Handout", pages: coll([page("p3", "Map", "<p>Public map</p>"), page("p4", "Img", "", "image")]) };
  const scene = { id: "S1", name: "Skull Cove", journal: sceneJ, notes: coll([{ text: "Cave mouth" }]), tokens: coll([
    { name: "Anne", hidden: false, disposition: 1, actor: { system: { hp: { value: 7, max: 9 } } } },
    { name: "Ghost Captain", hidden: true, disposition: -1, actor: { system: { hp: { value: 20, max: 20 } } } }]) };
  return { user, scenes: { ...coll([scene]), active: scene }, journal: coll([secret, sceneJ, other]),
    combat: { started: true, round: 2, turn: 0, combatant: { name: "Anne" }, turns: [{ name: "Anne", initiative: 14 }, { name: "Ghost Captain", initiative: 9, hidden: true }] } };
}
test("collectData: scene notes, hidden tokens, combat, journals", () => {
  const d = collectData(world({ isGM: true }), { journals: "Handout/Map, GM Only" });
  assert.equal(d.scene.name, "Skull Cove"); assert.match(d.scene.notes, /Smugglers/); assert.match(d.scene.notes, /Cave mouth/);
  assert.equal(d.tokens.find(t => t.name === "Ghost Captain").hidden, true);
  assert.deepEqual(d.journals.map(j => j.name), ["Handout", "Secrets"]); assert.equal(d.journals[0].pages.length, 1);
  const txt = renderContext(buildSections(d));
  assert.match(txt, /TOKENS hidden \(GM only\): Ghost Captain \(hostile\) HP 20\/20/); assert.match(txt, /COMBAT round 2/); assert.match(txt, /captain is a ghost/);
});
test("getContext is GM-permission gated", () => {
  const r = getContext(world({ isGM: false, id: "player" })); assert.equal(r.ok, false); assert.equal(r.code, 403); assert.equal(r.result, undefined);
  assert.equal(contextAllowed(null), false); assert.equal(contextAllowed({ isGM: true }), true);
});
test("getContext caches: unchanged context is not resent; diff sends only changed sections", () => {
  cache.last = null; const w = world({ isGM: true });
  const a = getContext(w); assert.ok(a.ok && a.result.full && a.result.text.includes("Skull Cove"));
  const b = getContext(w); assert.deepEqual(b.result, { hash: a.result.hash, unchanged: true });
  const c = getContext(w, { since: a.result.hash }); assert.equal(c.result.unchanged, true);
  w.combat.round = 3; const d = getContext(w); assert.equal(d.result.full, false); assert.deepEqual(d.result.changed, ["combat"]); assert.doesNotMatch(d.result.text, /SCENE/);
  const e = getContext(w, { since: "stale" }); assert.equal(e.result.full, true);
});
test("no player-visible output: no ChatMessage.create, no socket emit, no rendering", () => {
  const calls = []; const spy = (n) => (...a) => { calls.push(n); };
  globalThis.ChatMessage = { create: spy("ChatMessage.create") }; globalThis.ui = { notifications: { info: spy("notify") } };
  const w = world({ isGM: true }); w.socket = { emit: spy("socket.emit") }; globalThis.game = w;
  getContext(w, { full: true }); getContext(world({ isGM: false }));
  assert.deepEqual(calls, []);
  delete globalThis.ChatMessage; delete globalThis.ui; delete globalThis.game;
  const src = readFileSync("scripts/context.mjs", "utf8") + readFileSync("scripts/lib/context.mjs", "utf8");
  for (const bad of ["ChatMessage", "socket", "whisper", "renderTemplate", ".render(", "ui.notifications", "createEmbedded"]) assert.ok(!src.replace(/^\s*\/\/.*$/gm, "").includes(bad), bad);
});
test("context is only wired to the api and the command, never into events/socket", () => {
  const m = readFileSync("scripts/main.mjs", "utf8");
  assert.equal((m.match(/getContext\(/g) ?? []).length, 1); assert.match(m, /context: \(o = \{\}\) => getContext\(game/);
  for (const line of m.split("\n").filter(l => l.includes("socket.emit"))) assert.doesNotMatch(line, /context/i);
  assert.match(m, /if \(!game\.user\.isGM \|\| !isBot\(\)\) return fail\(403/); // command path gate
  const c = readFileSync("scripts/commands.mjs", "utf8"); assert.match(c, /getContext: \{ schema/);
});
