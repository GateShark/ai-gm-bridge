import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { prune, compactEvent, buildPayload } from "../scripts/lib/compact.mjs";
import { buildSections, ContextCache } from "../scripts/lib/context.mjs";
import { cleanupContextJournals } from "../scripts/gmstore.mjs";
import { configFromEnv, withContextDefaults } from "../relay/core.mjs";

// (bb) falsy values survive
test("prune keeps false, 0 and []; drops null/undefined/''", () => {
  assert.deepEqual(prune({ a: false, b: 0, c: [], d: null, e: undefined, f: "", g: { h: false, i: 0, j: "" } }), { a: false, b: 0, c: [], g: { h: false, i: 0 } });
});
test("rollResult keeps success/crit/fumble false and natural/total 0 through the payload", () => {
  const ev = { eventId: "rollreq:1", type: "rollResult", success: false, crit: false, fumble: false, total: 0, natural: 0, dr: 12, by: null };
  const p = buildPayload({ batchId: "b", world: "w", seq: 1, attempt: 1, events: [ev] }, {});
  assert.deepEqual(p.events[0], { eventId: "rollreq:1", type: "rollResult", success: false, crit: false, fumble: false, total: 0, natural: 0, dr: 12 });
  assert.deepEqual(compactEvent({ eventId: "x", round: 0, hp: 0, ok: false }), { eventId: "x", round: 0, hp: 0, ok: false });
});
test("ctx diff keeps 0/false values", () => {
  const p = buildPayload({ batchId: "b", world: "w", seq: 1, attempt: 1, events: [] }, { ctx: { round: 0, paused: false }, prevCtx: { round: 1, paused: true } });
  assert.deepEqual(p.ctx, { round: 0, paused: false });
});
test("audit: no remaining falsy-stripping in payload code", () => {
  for (const f of ["scripts/lib/compact.mjs", "scripts/lib/direct.mjs", "relay/core.mjs", "relay/foundry-client.mjs"]) {
    const s = readFileSync(f, "utf8"); assert.doesNotMatch(s, /v === false|filter\(Boolean\)\s*\)?\s*;?\s*\/\/?\s*payload|if \(!v\) continue/, f);
  }
});
// (aa-1) list out of client-synced data
test("relay AIGM_CONTEXT_JOURNALS fills getContext journals only when the bot didn't pass any", () => {
  const cfg = configFromEnv({ AIGM_WEBHOOK_URL: "u", AIGM_WEBHOOK_AUTH: "a", AIGM_CONTEXT_JOURNALS: "GM Only, Villains" });
  assert.equal(cfg.contextJournals, "GM Only, Villains");
  assert.deepEqual(withContextDefaults({ name: "getContext", args: { maxChars: 900 } }, cfg.contextJournals).args, { maxChars: 900, journals: "GM Only, Villains" });
  assert.deepEqual(withContextDefaults({ name: "getContext", args: { journals: "Other" } }, cfg.contextJournals).args, { journals: "Other" });
  assert.deepEqual(withContextDefaults({ name: "setHP", args: {} }, cfg.contextJournals).args, {});
  assert.deepEqual(withContextDefaults({ name: "getContext" }, "").args, undefined);
});
test("no world setting or form field holds the list; module never writes it", () => {
  const src = readFileSync("scripts/main.mjs", "utf8"); const regs = []; const game = { settings: { register: (m, k, o) => regs.push({ k, ...o }), registerMenu() {} } };
  const fn = src.slice(src.indexOf('Hooks.once("init"'), src.indexOf('Hooks.once("ready"'));
  new Function("game", "ID", "makeConfigApp", "log", fn.slice(fn.indexOf("{") + 1, fn.lastIndexOf("}")))(game, "ai-gm-bridge", () => class {}, () => {});
  const cj = regs.filter(r => r.k === "contextJournals"); assert.equal(cj.length, 1); assert.equal(cj[0].config, false); assert.equal(cj[0].default, "");
  assert.doesNotMatch(readFileSync("scripts/config-app.mjs", "utf8"), /contextJournals/);
  for (const f of readdirSync("scripts").filter(f => f.endsWith(".mjs")).map(f => "scripts/" + f))
    assert.doesNotMatch(readFileSync(f, "utf8"), /\bsetFlag\([^)]*contextJournals|settings\.set\([^)]*contextJournals"\s*,\s*[^"\s]/, f);
});
test("cleanup clears the old setting and deletes the empty v0.7.1 config journal", async () => {
  const st = { contextJournals: "GM Only" }; let deleted = false;
  const j = { flags: { "ai-gm-bridge": { gmConfig: true, contextJournals: "Villains" } }, pages: { size: 0 }, delete: async () => { deleted = true; } };
  const g = { user: { isGM: true }, settings: { get: (m, k) => st[k], set: async (m, k, v) => { st[k] = v; } }, journal: { find: (f) => [j].find(f) } };
  const r = await cleanupContextJournals(g); assert.equal(r.cleared, true); assert.equal(r.old, "GM Only, Villains"); assert.equal(st.contextJournals, ""); assert.equal(deleted, true);
  assert.equal((await cleanupContextJournals({ ...g, user: { isGM: false } })).cleared, false);
});
// (aa-2) memory-only cache
test("audit: context code never persists (no flags/settings/document writes)", () => {
  const s = readFileSync("scripts/context.mjs", "utf8") + readFileSync("scripts/lib/context.mjs", "utf8");
  for (const bad of ["setFlag", "settings.set", ".update(", ".create(", "localStorage", "sessionStorage", "createEmbeddedDocuments"]) assert.ok(!s.includes(bad), bad);
});
// (aa-3) per-journal diffs
test("per-journal sections: only the changed journal is resent", () => {
  const c = new ContextCache();
  const data = (t) => ({ scene: { name: "Cove" }, journals: [{ name: "A", pages: [{ name: "p", html: "alpha" }] }, { name: "B", pages: [{ name: "p", html: t }] }] });
  const first = c.diff(buildSections(data("beta"))); assert.ok(first.full); assert.ok(first.sectionHashes["journal:A"] && first.sectionHashes["journal:B"]);
  const d = c.diff(buildSections(data("beta 2"))); assert.deepEqual(d.changed, ["journal:B"]); assert.match(d.text, /beta 2/); assert.doesNotMatch(d.text, /alpha|SCENE/);
  const r = c.diff(buildSections({ scene: { name: "Cove" }, journals: [{ name: "A", pages: [{ name: "p", html: "alpha" }] }] })); assert.deepEqual(r.removed, ["journal:B"]);
});
test("README has a Known limits note", () => assert.match(readFileSync("README.md", "utf8"), /## Known limits[\s\S]*GM-only journals/));
