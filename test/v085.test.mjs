// 0.8.5 push-to-talk (Web Speech API) with a fake DOM and fake SpeechRecognition.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { PushToTalk, speechCtor, isTypingTarget, matchesKey, speechLang, joinResults, DEFAULT_KEY } from "../scripts/lib/ptt.mjs";
function el(tag) { const l = {}; return { tagName: tag.toUpperCase(), style: {}, l, addEventListener(t, f) { (l[t] ??= []).push(f); }, fire(t, e = {}) { for (const f of l[t] ?? []) f(e); }, removed: false, remove() { this.removed = true; doc.body.kids = doc.body.kids.filter(k => k !== this); } }; }
let doc; const mkDoc = () => { const l = {}; doc = { l, body: { kids: [], appendChild(e) { this.kids.push(e); } }, createElement: el, addEventListener(t, f) { (l[t] ??= []).push(f); }, removeEventListener(t, f) { l[t] = (l[t] ?? []).filter(x => x !== f); }, key(t, e) { for (const f of l[t] ?? []) f({ preventDefault() {}, ...e }); } }; return doc; };
class FakeRec { constructor() { FakeRec.last = this; this.started = 0; } start() { this.started++; } stop() { this.onend?.(); } say(parts) { this.onresult?.({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }); } }
const setup = (win = { webkitSpeechRecognition: FakeRec }) => { const posted = [], notes = []; const p = new PushToTalk({ win, doc: mkDoc(), post: async t => posted.push(t), notify: m => notes.push(m), t: k => k === "AIGM.ptt.listening" ? "Listening…" : k, lang: "de" }); return { p, posted, notes }; };
const ind = () => doc.body.kids.find(k => k.id === "aigm-ptt-indicator");

test("helpers: ctor detection, typing targets, key match, language, results", () => {
  assert.equal(speechCtor({ SpeechRecognition: 1, webkitSpeechRecognition: 2 }), 1); assert.equal(speechCtor({ webkitSpeechRecognition: 2 }), 2); assert.equal(speechCtor({}), null);
  assert.ok(isTypingTarget({ tagName: "textarea" })); assert.ok(isTypingTarget({ tagName: "DIV", isContentEditable: true })); assert.ok(!isTypingTarget({ tagName: "BODY" })); assert.ok(!isTypingTarget(null));
  assert.equal(DEFAULT_KEY, "Backquote"); assert.ok(matchesKey({ code: "Backquote", key: "`" })); assert.ok(matchesKey({ code: "KeyV" }, "KeyV")); assert.ok(matchesKey({ key: "`" }, "`")); assert.ok(!matchesKey({ code: "KeyA", key: "a" }));
  assert.equal(speechLang("pt_BR"), "pt-BR"); assert.equal(speechLang("", "fr-FR"), "fr-FR");
  assert.deepEqual(joinResults([Object.assign([{ transcript: "hello " }], { isFinal: true }), Object.assign([{ transcript: "wor" }], { isFinal: false })]), { final: "hello", interim: "wor" });
});
test("hold key: listening indicator with interim text, release posts final transcript once", async () => {
  const { p, posted } = setup(); assert.equal(p.install(), true); assert.ok(doc.body.kids.some(k => k.id === "aigm-ptt-button"));
  doc.key("keydown", { code: "Backquote", target: { tagName: "BODY" } }); const r = FakeRec.last;
  assert.equal(r.started, 1); assert.equal(r.lang, "de"); assert.equal(r.interimResults, true); assert.equal(ind().textContent, "Listening…");
  doc.key("keydown", { code: "Backquote", repeat: true, target: { tagName: "BODY" } }); assert.equal(FakeRec.last, r); // auto-repeat ignored
  r.say([["I open", true], [" the do", false]]); assert.equal(ind().textContent, "Listening… I open the do");
  r.say([["I open the door", true]]); doc.key("keyup", { code: "Backquote" }); await new Promise(s => setImmediate(s));
  assert.deepEqual(posted, ["I open the door"]); assert.equal(ind(), undefined);
});
test("key ignored while typing; silent hold posts nothing; mic button works", async () => {
  const { p, posted } = setup(); p.install();
  doc.key("keydown", { code: "Backquote", target: { tagName: "INPUT" } }); assert.equal(p.active, false);
  doc.key("keydown", { code: "Backquote", target: { tagName: "BODY" } }); doc.key("keyup", { code: "Backquote" }); await new Promise(s => setImmediate(s)); assert.deepEqual(posted, []);
  const b = doc.body.kids.find(k => k.id === "aigm-ptt-button"); b.fire("pointerdown", { preventDefault() {} }); FakeRec.last.say([["roll for me", true]]); b.fire("pointerup");
  await new Promise(s => setImmediate(s)); assert.deepEqual(posted, ["roll for me"]);
  p.uninstall(); assert.equal(doc.l.keydown.length, 0); assert.ok(!doc.body.kids.some(k => k.id === "aigm-ptt-button"));
});
test("no API (Firefox): one-time notice and no button", () => {
  const { p, notes } = setup({}); assert.equal(p.install(), false); assert.deepEqual(notes, ["AIGM.ptt.unavailable"]); assert.equal(doc.body.kids.length, 0);
  const q = new PushToTalk({ win: {}, doc: mkDoc(), notify: m => notes.push(m), onceNotice: () => false }); q.install(); assert.equal(notes.length, 1);
});
test("mic denied shows notice; settings are client scope and off by default; strings localized", () => {
  const { p, notes } = setup(); p.install(); p.start(); FakeRec.last.onerror({ error: "not-allowed" }); assert.deepEqual(notes, ["AIGM.ptt.denied"]);
  const m = readFileSync("scripts/main.mjs", "utf8"); assert.match(m, /register\(ID, "pushToTalk", \{ scope: "client", config: true, type: Boolean, default: false/);
  assert.match(m, /register\(ID, "pushToTalkKey", \{ scope: "client"/);
  const en = JSON.parse(readFileSync("lang/en.json", "utf8")).AIGM; for (const k of ["listening", "button", "unavailable", "denied"]) assert.ok(en.ptt[k]); assert.ok(en.settings.pushToTalk.name);
});
