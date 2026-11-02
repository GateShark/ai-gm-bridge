import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ThinkingIndicator, THINKING_ID } from "../scripts/lib/thinking.mjs";
function fakeDoc() {
  const els = new Map();
  return { els, body: { appendChild: (e) => els.set(e.id, e) }, getElementById: (id) => els.get(id) ?? null,
    createElement: () => { const e = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { els.delete(this.id); } }; return e; } };
}
function clock() { let t = 0, timers = [], id = 0; return { now: () => t, setT: (f, ms) => { const h = ++id; timers.push({ h, f, at: t + ms }); return h; },
  clearT: (h) => { timers = timers.filter(x => x.h !== h); }, advance(ms) { t += ms; const due = timers.filter(x => x.at <= t); timers = timers.filter(x => x.at > t); due.forEach(x => x.f()); }, get n() { return timers.length; } }; }
test("0.8.6 queued messages never push the timeout out", () => {
  const c = clock(), doc = fakeDoc(); const t = new ThinkingIndicator({ doc, ...c });
  t.show(90000); c.advance(60000); t.show(90000); c.advance(20000); t.show(90000); assert.ok(t.visible);
  c.advance(10000); assert.equal(t.visible, false); assert.equal(c.n, 0);
});
test("0.8.6 hide resets the deadline; next show gets a full timeout", () => {
  const c = clock(), doc = fakeDoc(); const t = new ThinkingIndicator({ doc, ...c });
  t.show(90000); c.advance(80000); t.hide(); t.show(90000); c.advance(80000); assert.ok(t.visible); c.advance(10000); assert.equal(t.visible, false);
});
test("0.8.6 timeout 0 shows with no timer", () => {
  const c = clock(), doc = fakeDoc(); const t = new ThinkingIndicator({ doc, ...c }); t.show(0); assert.ok(t.visible); assert.equal(c.n, 0); t.hide(); assert.equal(doc.els.has(THINKING_ID), false);
});
test("0.8.6 main.mjs clears the pill on ack, clearDead, combat end and deleteCombat", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /ack: \(eventIds\) => \{ thinkingOff\(\{ broadcast: true \}\)/);
  assert.match(m, /clearDead: \(\) => \{ thinkingOff\(\{ broadcast: true \}\)/);
  assert.match(m, /deleteCombat", \(c\) => \{ if \(enabled\(\)\) thinking\.hide\(\)/);
  assert.match(m, /state === "end"\) thinkingOff\(\{ broadcast: true \}\)/);
  assert.match(m, /isBot\(msg\.author \?\? msg\.user \?\? \{\}\)\) thinking\.hide\(\)/);
});
import { rollBreakdown, cardHtml } from "../scripts/lib/rollreq.mjs";
test("0.8.6 rollBreakdown: d20 + modifier", () => {
  const b = rollBreakdown({ total: 20, terms: [{ faces: 20, number: 1, results: [{ result: 19, active: true }] }, { operator: "+" }, { number: 1 }] });
  assert.equal(b.text, "d20 19 + 1 = 20"); assert.equal(b.modifier, 1); assert.deepEqual(b.dice[0].kept, [19]);
});
test("0.8.6 rollBreakdown: negative mod, multi dice, discarded, no dice", () => {
  assert.equal(rollBreakdown({ total: 9, dice: [{ faces: 20, results: [{ result: 11 }] }] }).text, "d20 11 - 2 = 9");
  assert.equal(rollBreakdown({ total: 7, dice: [{ faces: 6, number: 2, results: [{ result: 3 }, { result: 4 }] }] }).text, "2d6 3+4 = 7");
  assert.equal(rollBreakdown({ total: 15, dice: [{ faces: 20, number: 2, results: [{ result: 5, active: false, discarded: true }, { result: 15 }] }] }).text, "2d20 15 = 15");
  assert.equal(rollBreakdown({ total: 3, terms: [{ number: 3 }] }), null); assert.equal(rollBreakdown(null), null);
});
test("0.8.6 roll card shows breakdown; old results without it still render", () => {
  const base = { id: "r1", stat: "strength", dr: 12, actorName: "Hero", status: "done" };
  assert.match(cardHtml({ ...base, result: { total: 20, success: true, breakdown: "d20 19 + 1 = 20" } }), /d20 19 \+ 1 = 20 → <b>20<\/b>/);
  assert.match(cardHtml({ ...base, result: { total: 20, success: true } }), /<br><b>20<\/b>/);
});
test("0.8.6 rollResult event and chat rolls carry breakdown, keep total", () => {
  const f = readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8");
  assert.match(f, /breakdown: bd\.text, dice: bd\.dice, modifier: bd\.modifier/);
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /formula: r\.formula, total: r\.total, \.\.\.\(b \? \{ breakdown/);
});
