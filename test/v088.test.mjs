// 0.8.8 UI polish: settings groups, status light, GM panel, voice chrome, connection test.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASIC_KEYS, ADVANCED_KEYS, HIDDEN_KEYS, ALL_KNOWN_KEYS, groupFor, testConnection } from "../scripts/lib/settingsui.mjs";
import { deriveGmStatus, formatLastReply, statusTooltip, GmStatusPill, STATUS_ID } from "../scripts/lib/gmstatus.mjs";
import { collectHp, makeControlEvent, panelHtml, installSidebarButton } from "../scripts/lib/gmpanel.mjs";
import { extractVoiceSrc, plainVoiceText, shouldCollapse, collapseParts, replayId, enhanceVoiceMessage } from "../scripts/lib/voiceui.mjs";
import { cardHtml, isOpen } from "../scripts/lib/rollreq.mjs";
import { ThinkingIndicator, THINKING_ID } from "../scripts/lib/thinking.mjs";
import { AudioQueue } from "../scripts/lib/audioqueue.mjs";
import { injectStyles } from "../scripts/lib/styles.mjs";
import { PushToTalk } from "../scripts/lib/ptt.mjs";

test("0.8.8 setting keys are grouped; internals hidden; no unknown regs in main", () => {
  for (const k of ["enabled", "botUserId", "webhookUrl", "webhookSecret", "alwaysVoiceUsers", "pushToTalkKey", "combatEvents"])
    assert.equal(groupFor(k), "basic", k);
  for (const k of ["debounceMs", "uploadsEnabled", "metricsLogEvery", "thinkingTimeoutMs"]) assert.equal(groupFor(k), "advanced", k);
  for (const k of ["dedupeState", "outboxState", "voiceCache", "contextJournals", "pushToTalkNoticeShown"]) assert.equal(groupFor(k), "hidden", k);
  assert.equal(groupFor("aiPaused"), "panel");
  assert.ok(!BASIC_KEYS.includes("dedupeState") && !ADVANCED_KEYS.includes("dedupeState"));
  const src = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  const keys = [...src.matchAll(/\breg\("([^"]+)"/g), ...src.matchAll(/register\(ID, "([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.includes("aiPaused"));
  for (const k of keys) assert.notEqual(groupFor(k), "unknown", k);
  for (const k of ALL_KNOWN_KEYS) assert.ok(typeof k === "string" && k);
  const form = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.match(form, /aigm-advanced/); assert.match(form, /data-aigm-test/); assert.doesNotMatch(form, /contextJournals|dedupeState|outboxState/);
  assert.match(src, /scope: "world", config: false, restricted: true/);
});

test("0.8.8 testConnection: webhook OK/fail, relay fallback, secret redacted", async () => {
  const ok = await testConnection({ url: "https://example.invalid/hook", fetchImpl: async () => ({ status: 200 }) });
  assert.equal(ok.ok, true); assert.equal(ok.status, 200); assert.equal(ok.via, "webhook");
  const bad = await testConnection({ url: "https://example.invalid/hook", fetchImpl: async () => ({ status: 503 }) });
  assert.equal(bad.ok, false); assert.match(bad.error, /503/);
  const none = await testConnection({});
  assert.equal(none.ok, false); assert.equal(none.via, "none");
  const relayOk = await testConnection({ botActive: true });
  assert.equal(relayOk.ok, true); assert.equal(relayOk.via, "botUser");
  const relayOff = await testConnection({ botActive: false });
  assert.equal(relayOff.ok, false); assert.equal(relayOff.via, "botUser");
  const leak = await testConnection({ url: "https://example.invalid/hook", secret: "super-secret", fetchImpl: async () => { throw new Error("nope super-secret"); } });
  assert.equal(leak.ok, false); assert.ok(!String(leak.error).includes("super-secret")); assert.match(leak.error, /\[redacted\]/);
});

test("0.8.8 deriveGmStatus and last-reply tooltip", () => {
  assert.equal(deriveGmStatus({ enabled: false, botActive: true }), "offline");
  assert.equal(deriveGmStatus({ enabled: true, thinking: true, botActive: true }), "thinking");
  assert.equal(deriveGmStatus({ enabled: true, paused: true, botActive: true }), "paused");
  assert.equal(deriveGmStatus({ enabled: true, botActive: true }), "listening");
  assert.equal(deriveGmStatus({ enabled: true, leaderIsBot: true, lastBeat: 1000, now: 2000, timeoutMs: 45000 }), "listening");
  assert.equal(deriveGmStatus({ enabled: true, leaderIsBot: true, lastBeat: 1000, now: 100000, timeoutMs: 45000 }), "offline");
  assert.equal(deriveGmStatus({}), "offline");
  assert.equal(formatLastReply(0), "");
  const ts = Date.parse("2026-11-09T17:45:00");
  assert.match(formatLastReply(ts, ts + 1000), /17:45/);
  assert.equal(statusTooltip(null, { none: "No replies yet" }), "No replies yet");
  assert.match(statusTooltip(ts, { now: ts + 1000, last: "Last reply" }), /Last reply: .*17:45/);
});

test("0.8.8 status pill paints states and title", () => {
  const els = new Map();
  const doc = { els, body: { appendChild: (e) => els.set(e.id, e) }, getElementById: (id) => els.get(id) ?? null,
    createElement: () => { const e = { style: {}, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, remove() { els.delete(this.id); } }; return e; } };
  const p = new GmStatusPill({ doc, t: (k, f) => f });
  p.mount(); p.set("listening", { lastReplyAt: null });
  assert.equal(doc.els.get(STATUS_ID).dataset.state, "listening");
  assert.equal(doc.els.get(STATUS_ID).textContent, "GM listening");
  assert.equal(doc.els.get(STATUS_ID).title, "No replies yet");
  p.set("thinking"); assert.equal(doc.els.get(STATUS_ID).textContent, "GM thinking…");
  p.set("offline"); assert.equal(doc.els.get(STATUS_ID).dataset.state, "offline");
});

test("0.8.8 thinking silent mode drives visible without a second DOM pill", () => {
  const els = new Map();
  const doc = { els, body: { appendChild: (e) => els.set(e.id, e) }, getElementById: (id) => els.get(id) ?? null,
    createElement: () => { const e = { style: {}, remove() { els.delete(this.id); } }; return e; } };
  const t = new ThinkingIndicator({ doc, silent: true });
  assert.equal(t.show(0), true); assert.equal(t.visible, true); assert.equal(els.has(THINKING_ID), false);
  assert.equal(t.hide(), true); assert.equal(t.visible, false); assert.equal(t.hide(), false);
});

test("0.8.8 panel HTML and HP list", () => {
  const hp = collectHp([
    { id: "2", name: "Rat", hasPlayerOwner: false, system: { attributes: { hp: { value: 3, max: 4 } } } },
    { id: "1", name: "Hero", hasPlayerOwner: true, system: { attributes: { hp: { value: 8, max: 10 } } } }
  ]);
  assert.deepEqual(hp.map(h => h.name), ["Hero", "Rat"]);
  assert.equal(hp[0].pc, true); assert.equal(hp[0].value, 8);
  const html = panelHtml({ paused: false, turn: { round: 2, name: "Hero", next: "Rat" }, pending: [{ id: "r1", actorName: "Hero", stat: "agility", dr: 12 }], hp, recapText: "" });
  assert.match(html, /data-aigm-action="pause"/);
  assert.match(html, /data-aigm-action="redo"/);
  assert.match(html, /data-aigm-action="skip"/);
  assert.match(html, /data-aigm-action="recap"/);
  assert.match(html, /Round 2: Hero is up/);
  assert.match(html, /data-aigm-action="cancelRoll"/);
  assert.match(html, /8\/10/);
  assert.match(panelHtml({ paused: true }), /data-aigm-action="resume"/);
  const ev = makeControlEvent("redo", { targetEventIds: ["chat:1"] }, 99);
  assert.deepEqual(ev, { eventId: "control:redo:99", type: "control", action: "redo", targetEventIds: ["chat:1"] });
});

test("0.8.8 sidebar button installs once", () => {
  const kids = [];
  const nav = { appendChild(e) { kids.push(e); this.last = e; } };
  const doc = { _nav: nav, getElementById: (id) => id === "sidebar-tabs" ? nav : (kids.find(k => k.id === id) ?? null),
    querySelector: () => nav, createElement: () => { const e = { style: {}, dataset: {}, setAttribute() {}, addEventListener() {} }; return e; }, body: { appendChild() {} } };
  assert.equal(installSidebarButton({ doc, label: "AI GM", open: () => {} }), true);
  assert.equal(doc._nav.last.id, "aigm-sidebar-btn");
  assert.equal(installSidebarButton({ doc, open: () => {} }), false);
});

test("0.8.8 roll cards keep old markup, add a big button, and support cancelled", () => {
  const base = { id: "r<1", stat: "agility", dr: 12, actorName: "Bart <b>", userName: "Pat", label: "" };
  const pending = cardHtml({ ...base, status: "pending" });
  assert.match(pending, /data-aigm-roll="r&lt;1">Roll Agility/);
  assert.match(pending, /class="aigm-roll-btn"/);
  assert.match(pending, /data-status="pending"/);
  assert.match(cardHtml({ id: "x", formula: "1d6", label: "Broken", actorName: "Bart", userName: "Pat", status: "pending", dr: null }), /<b>Broken<\/b><br>/);
  assert.match(cardHtml({ ...base, status: "cancelled" }), /Cancelled/);
  assert.equal(isOpen({ status: "cancelled" }, 1), false);
  assert.equal(isOpen({ status: "pending" }, 1), true);
});

test("0.8.8 voice replay and collapse helpers", () => {
  const html = 'A long intro.<audio controls preload="none" src="worlds/x/a.mp3"></audio>';
  assert.equal(extractVoiceSrc(html), "worlds/x/a.mp3");
  assert.equal(plainVoiceText(html), "A long intro.");
  assert.equal(shouldCollapse("short"), false);
  assert.equal(shouldCollapse("x".repeat(281)), true);
  const parts = collapseParts("hello world", 5);
  assert.equal(parts.collapsed, true); assert.equal(parts.short, "hello…");
  assert.match(replayId("a.mp3", 7), /^replay:a\.mp3:7$/);
  const played = [];
  const kids = [];
  const audio = { nodeType: 1, nodeName: "AUDIO", getAttribute: () => "worlds/x/a.mp3", parentNode: { childNodes: [], insertBefore(n) { kids.push(n); } } };
  const root = { querySelector: (s) => s === "audio[src]" ? audio : (s === "[data-aigm-replay]" ? kids[0] : null), ownerDocument: { createElement: () => { const e = { style: {}, dataset: {}, setAttribute() {}, addEventListener(t, f) { this.fn = f; }, click() { this.fn?.({ preventDefault() {}, stopPropagation() {} }); } }; return e; } } };
  assert.equal(enhanceVoiceMessage({ content: html }, root, { replay: (src) => played.push(src) }), true);
  assert.equal(kids[0].textContent, "▶");
  kids[0].click(); assert.deepEqual(played, ["worlds/x/a.mp3"]);
  assert.equal(enhanceVoiceMessage({ content: html }, root, { replay: () => {} }), false);
});

test("0.8.8 audio queue replay ignores seen ids", async () => {
  const log = [];
  const q = new AudioQueue({ play: async (c) => { log.push(c); }, gapMs: 0, sleep: async () => {} });
  assert.equal((await q.enqueue("clip", "a.mp3")).played, true);
  assert.equal((await q.enqueue("clip", "a.mp3")).duplicate, true);
  assert.equal((await q.replay("a.mp3")).played, true);
  assert.deepEqual(log, ["a.mp3", "a.mp3"]);
});

test("0.8.8 styles inject once; PTT button has a mic light class while live", () => {
  const els = {};
  const head = { appendChild(e) { els[e.id] = e; } };
  const doc = { head, body: head, getElementById: (id) => els[id] ?? null, createElement: () => ({ id: "", textContent: "" }) };
  assert.equal(injectStyles(doc), true); assert.ok(els["aigm-styles"].textContent.includes("#aigm-gm-status"));
  assert.equal(injectStyles(doc), false);
});

test("0.8.8 PTT install can skip the keyboard and still make the button", () => {
  const l = {}; const kids = [];
  const doc = { l, body: { kids, appendChild(e) { kids.push(e); } }, createElement: () => ({ style: {}, l: {}, setAttribute() {}, addEventListener(t, f) { (this.l[t] ??= []).push(f); } }),
    addEventListener(t, f) { (l[t] ??= []).push(f); }, removeEventListener(t, f) { l[t] = (l[t] ?? []).filter(x => x !== f); } };
  class FakeRec { start() {} stop() { this.onend?.(); } }
  const p = new PushToTalk({ win: { webkitSpeechRecognition: FakeRec }, doc, post: async () => {}, t: k => k });
  assert.equal(p.install({ keyboard: false }), true);
  assert.equal(l.keydown, undefined);
  assert.ok(kids.some(k => k.id === "aigm-ptt-button"));
  p.start(); assert.match(kids.find(k => k.id === "aigm-ptt-button").className, /aigm-ptt-live/);
  p.uninstall();
});

test("0.8.8 cancelRollRequest marks the card and emits rollCancelled", async () => {
  const msgs = []; const emitted = [];
  const mkMsg = (d) => { const m = { id: "m1", ...d, async update(u) { if (u.content) m.content = u.content; const fl = Object.entries(u).find(([k]) => k.startsWith("flags.")); if (fl) m.flags["ai-gm-bridge"].rollRequest = fl[1]; } }; msgs.push(m); return m; };
  const priorGame = globalThis.game, priorCM = globalThis.ChatMessage, priorFoundry = globalThis.foundry;
  globalThis.foundry = { utils: { randomID: () => "x" } };
  globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
  const req = { id: "rr1", userId: "p1", userName: "Pat", actorName: "Hero", stat: "agility", dr: 10, status: "pending", at: 1 };
  const msg = await mkMsg({ flags: { "ai-gm-bridge": { rollRequest: req } }, content: "old" });
  globalThis.game = { messages: { get contents() { return msgs; }, get: id => msgs.find(m => m.id === id) } };
  const F = await import("../scripts/features.mjs");
  F.initFeatures({ emit: (ev) => emitted.push(ev), get: () => undefined, amLeader: () => true });
  const r = await F.cancelRollRequest("rr1");
  assert.equal(r.ok, true); assert.equal(r.result.status, "cancelled");
  assert.match(msg.content, /Cancelled/);
  assert.equal(emitted[0].type, "rollCancelled"); assert.equal(emitted[0].requestId, "rr1");
  assert.equal(F.pendingRequests().length, 0);
  globalThis.game = priorGame; globalThis.ChatMessage = priorCM; globalThis.foundry = priorFoundry;
});

test("0.8.8 main wiring, cancelRoll command, localization, public credits", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /data\.type === "gmControl"/);
  assert.match(m, /get\("aiPaused"\)/);
  assert.match(m, /enhanceVoiceMessage/);
  assert.match(m, /showAudioUnlockPrompt/);
  assert.match(m, /installSidebarButton/);
  assert.match(m, /evenIfPaused/);
  const c = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(c, /cancelRoll:/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  for (const k of ["listening", "thinking", "offline", "paused", "lastReply"]) assert.ok(en.status[k]);
  assert.equal(en.audio.enableSound, "Enable sound");
  assert.ok(en.panel.pause && en.panel.redo && en.voice.replay);
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.equal(ver, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  assert.match(ver, /^\d+\.\d+\.\d+/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /Alpha/); assert.match(readme, /Gate \(GateShark\)/); assert.doesNotMatch(readme, /Kevin|Allen/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.8/);
});
