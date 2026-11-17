// 0.9.8: bot setup prompt teaches faster replies (docs only). Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("0.9.8 the bot setup prompt has the speak-first, short-lines and short-work bullets in Speaking and status, and Core rule 10", () => {
  const p = src("docs/bot-setup-prompt.md");
  const speaking = p.slice(p.indexOf("## Speaking and status"), p.indexOf("## Core rules"));
  assert.match(speaking, /\*\*Speak first, then do the bookkeeping\.\*\*/);
  assert.match(speaking, /\*\*Short spoken lines\.\*\*/);
  assert.match(speaking, /\*\*Keep the work before the reply short\.\*\*/);
  const i = (s) => speaking.indexOf(s);
  assert.ok(i("Post **narration first**") < i("Speak first") && i("Speak first") < i("Short spoken lines") && i("Short spoken lines") < i("Status pill") && i("Status pill") < i("Keep the work"), "bullet order");
  const rules = p.slice(p.indexOf("## Core rules"), p.indexOf("## Events"));
  assert.match(rules, /\n9\. \*\*Several players at once\.\*\*[\s\S]*\n10\. \*\*Reply fast, edit after\.\*\*/);
  assert.doesNotMatch(p, /\n11\. /);
  assert.match(p, /ai-gm-bridge v0\.9\.8\)/); assert.doesNotMatch(p, /v0\.9\.7/);
});

test("0.9.8 the prompt stays generic: no rig, routine-file or personal names, recorded voices only, Ryan default", () => {
  const p = src("docs/bot-setup-prompt.md");
  assert.doesNotMatch(p, /Kev\b|Kevin|live\.js|pb-test|pb-test-live|live-state|Helper\b|Sonia/i);
  assert.match(p, /default Ryan/);
});

test("0.9.8 version, changelog, README, and the GM, wait cooldown note", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.8"); assert.equal(p.version, "0.9.8"); assert.equal(m.title, "AI GM Pirate Borg"); assert.equal(m.id, "ai-gm-bridge");
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.8/); assert.match(src("README.md"), /v0\.9\.8/);
  assert.match(src("CHANGELOG.md"), /3 second cooldown/);
  assert.match(src("scripts/lib/voiceui.mjs"), /HOLD_COOLDOWN_MS = 3000/);
});

// ================= AI GM status badge ("GM Ping") =================
import { ReplyTimes, pingDot, buildSnapshot, createPublisher, rowText, detailLines, diagnosticsText, shouldShow, clampBox, defaultPosition, attachDrag, GmPingBadge, buildModel, scrub, fmtMs, fmtSecs, fmtAgo, GMPING_PUBLISH_MS } from "../scripts/lib/gmping.mjs";
import { deliverDirect } from "../scripts/lib/direct.mjs";
import { groupFor, CLIENT_KEYS, HIDDEN_KEYS, ALL_KNOWN_KEYS } from "../scripts/lib/settingsui.mjs";

// a small DOM: elements keep listeners and can be driven with pointer events
function mkEl(tag = "div") {
  const el = { tag, style: {}, dataset: {}, children: [], listeners: {}, attrs: {}, hidden: false, offsetWidth: 190, offsetHeight: 24, textContent: "", title: "",
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] ?? []).filter(x => x !== f); },
    fire(t, e = {}) { for (const f of this.listeners[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, target: this, ...e }); },
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, remove() { this.removed = true; },
    getBoundingClientRect() { return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: this.offsetWidth, height: this.offsetHeight }; },
    querySelector(sel) { return this.kids?.[sel] ?? null; } };
  return el;
}
function mkDoc() {
  const doc = mkEl("doc"); doc.body = mkEl("body"); doc.byId = {};
  doc.getElementById = (id) => doc.byId[id] ?? null;
  doc.createElement = (tag) => { const e = mkEl(tag); Object.defineProperty(e, "innerHTML", { set(h) { // build the child hooks the badge uses
      this.kids = {}; for (const c of [".aigm-ping-text", ".aigm-ping-eye", ".aigm-ping-lines", ".aigm-ping-dot"]) if (String(h).includes(c.slice(1))) this.kids[c] = mkEl("span"); }, get() { return ""; } }); return e; };
  doc.body.appendChild = (c) => { doc.byId[c.id] = c; c.parentNode = doc.body; return c; };
  return doc;
}

test("0.9.8 ping: the dot is green when seen under a minute ago, yellow at 1-5 minutes or with an event waiting a minute, red when offline, not receiving or quiet 5+ minutes", () => {
  const now = 1_000_000;
  assert.equal(pingDot({ seenAt: now - 2000, now }), "green");
  assert.equal(pingDot({ seenAt: now - 2000, oldestWaitingAt: now - 30000, now }), "green", "an event waiting under a minute is normal");
  assert.equal(pingDot({ seenAt: now - 61000, now }), "yellow");
  assert.equal(pingDot({ seenAt: now - 2000, oldestWaitingAt: now - 70000, now }), "yellow");
  assert.equal(pingDot({ seenAt: now - 299000, now }), "yellow");
  assert.equal(pingDot({ seenAt: now - 301000, now }), "red");
  assert.equal(pingDot({ seenAt: 0, now }), "red", "never seen");
  assert.equal(pingDot({ seenAt: now - 1000, offline: true, now }), "red"); assert.equal(pingDot({ seenAt: now - 1000, notReceiving: true, now }), "red"); assert.equal(pingDot({ seenAt: now - 1000, enabled: false, now }), "red");
});

test("0.9.8 ping: the line reads AI GM · webhook ms · reply s · seen ago, and leaves out what is not measured", () => {
  const now = 5_000_000;
  const snap = buildSnapshot({ seenAt: now - 2000, webhookMs: 140, replies: [31000, 18000], mode: "direct" });
  assert.equal(rowText({ snap, state: "listening", seenAt: now - 2000, now }), "AI GM · 140 ms · reply 18 s · seen 2 s ago");
  assert.equal(rowText({ snap: buildSnapshot({ seenAt: now - 5000 }), state: "listening", seenAt: now - 5000, now }), "AI GM · seen 5 s ago", "relay mode, no reply yet: only what exists");
  assert.equal(rowText({ snap, state: "offline", seenAt: now - 200000, now }), "AI GM · offline · reply 18 s · seen 3 min ago");
  assert.equal(rowText({ snap: null, state: "listening", seenAt: 0, now }), "AI GM · not seen yet");
  assert.equal(fmtMs(1500), "1.5 s"); assert.equal(fmtMs(12), "12 ms"); assert.equal(fmtSecs(125000), "2 min"); assert.equal(fmtAgo(1e7 - 7200000, 1e7), "2 h ago");
});

test("0.9.8 ping: reply time runs from the first player chat line in a batch to the GM post that answers it; the last 5 are kept", () => {
  const r = new ReplyTimes();
  assert.equal(r.openBatch([{ type: "combat", eventId: "c1" }], 1000), false, "no chat line, nothing to time");
  r.openBatch([{ type: "chat", eventId: "chat:A", firstAt: 10_000 }, { type: "chat", eventId: "chat:B", firstAt: 12_000 }], 14_000);
  assert.equal(r.reply(28_000, "chat:A"), 18_000, "from the FIRST line (10 s), not the second");
  assert.equal(r.reply(30_000), null, "nothing open: a second post is not a reply");
  for (let i = 1; i <= 7; i++) { r.openBatch([{ type: "chat", eventId: `chat:${i}`, firstAt: i * 1000 }], i * 1000); r.reply(i * 1000 + i * 100, `chat:${i}`); }
  assert.equal(r.list().length, 5); assert.equal(r.last, 700); assert.deepEqual(r.list(), [300, 400, 500, 600, 700]);
  r.openBatch([{ type: "chat", eventId: "chat:X", firstAt: 1 }, ], 1); r.openBatch([{ type: "chat", eventId: "chat:Y", firstAt: 100 }], 100);
  assert.equal(r.reply(1100, "chat:Y"), 1000, "replyTo picks the batch it names"); assert.equal(r.reply(2000), 1999, "else the oldest open one");
  const old = new ReplyTimes({ openTtlMs: 1000 }); old.openBatch([{ type: "chat", eventId: "z", firstAt: 0 }], 0); assert.equal(old.reply(5000), null, "an old unanswered batch is forgotten");
});

test("0.9.8 ping: the webhook time is measured on the batch POST the add-on already makes (to the answer, before commands run), not on failures", async () => {
  let t = 1000; const clock = () => t;
  const ok = await deliverDirect({ batchId: "b", events: [{ eventId: "e1" }] }, { url: "https://bot.example.com/h", secret: "s", now: clock, runCommand: async () => { t += 5000; return { ok: true }; }, ack: async () => {},
    fetchImpl: async () => { t += 140; return { status: 200, text: async () => JSON.stringify({ commands: [{ name: "post" }] }) }; } });
  assert.equal(ok.ok, true); assert.equal(ok.webhookMs, 140, "the 5 s of command work is not counted");
  const bad = await deliverDirect({ batchId: "b2", events: [] }, { url: "https://bot.example.com/h", now: clock, fetchImpl: async () => { t += 60; return { status: 500, text: async () => "" }; } });
  assert.equal(bad.ok, false); assert.equal(bad.webhookMs, 60);
  const none = await deliverDirect({ batchId: "b3", events: [] }, { url: "", now: clock }); assert.equal(none.webhookMs, undefined);
  assert.match(src("scripts/main.mjs"), /S\.webhookMs = r\.webhookMs/);
});

test("0.9.8 ping: the snapshot and the diagnostics carry no secret and no URL", () => {
  const snap = buildSnapshot({ lastError: "Failed to fetch https://hooks.example.com/abc?token=SECRETSECRETSECRETSECRET123 and key AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", mode: "direct", version: "0.9.8", queued: 2, oldestWaitingAt: 1000, replies: [1000, 2000] });
  const all = JSON.stringify(snap) + diagnosticsText({ snap, state: "listening", seenAt: 5000, now: 9000, version: "0.9.8" });
  assert.doesNotMatch(all, /https?:\/\/|SECRETSECRET|AbCdEfGh/); assert.match(all, /\[url\]/);
  assert.match(diagnosticsText({ snap, state: "listening", seenAt: 5000, now: 9000, version: "0.9.8" }), /Add-on version: 0\.9\.8/);
  const d = detailLines({ snap, state: "listening", seenAt: 5000, now: 9000 }).join("\n");
  for (const w of ["Connection: webhook", "Undelivered events: 2", "Last replies: 1 s, 2 s", "Last error:", "Add-on version"]) assert.ok(d.includes(w), w);
  assert.equal(scrub("plain words stay"), "plain words stay");
});

test("0.9.8 ping: the leader publishes at most once per 5 s, only when something changed, and the last change is never lost", () => {
  let t = 0; const writes = []; const timers = [];
  const pub = createPublisher({ write: (s) => writes.push(s), now: () => t, setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; } });
  const a = buildSnapshot({ seenAt: 1 }), b = buildSnapshot({ seenAt: 2 }), c = buildSnapshot({ seenAt: 3 });
  assert.equal(pub.push(a), true); assert.equal(writes.length, 1);
  assert.equal(pub.push(a), false, "unchanged: no write"); assert.equal(writes.length, 1);
  t = 1000; assert.equal(pub.push(b), false); t = 2000; pub.push(c); assert.equal(writes.length, 1, "throttled"); assert.equal(timers.length, 1);
  assert.ok(timers[0].ms <= GMPING_PUBLISH_MS && timers[0].ms > 0);
  t = 5000; timers[0].f(); assert.equal(writes.length, 2); assert.equal(writes[1].seenAt, 3, "the newest value went out");
  t = 12000; assert.equal(pub.push(buildSnapshot({ seenAt: 9 })), true, "after the window it writes at once"); assert.equal(writes.length, 3);
});

test("0.9.8 ping: visibility is the world switch AND the personal switch, never in the bot's own browser, and a quiet bot shows red", () => {
  assert.equal(shouldShow({}), true);
  assert.equal(shouldShow({ allow: false }), false, "GM turned the row off for everyone");
  assert.equal(shouldShow({ show: false }), false, "this user turned it off");
  assert.equal(shouldShow({ allow: false, show: true }), false); assert.equal(shouldShow({ enabled: false }), false); assert.equal(shouldShow({ isBot: true }), false);
  const m = buildModel({ snap: buildSnapshot({ seenAt: 0 }), state: "offline", seenAt: 0, now: 9e6 }); assert.equal(m.dot, "red"); assert.match(m.text, /offline/);
});

test("0.9.8 ping: the badge stays on screen after a resize, defaults just above the Players list, and falls back to bottom left", () => {
  assert.deepEqual(clampBox(5000, 5000, { vw: 1000, vh: 700, w: 200, h: 24 }), { x: 800, y: 676 }); assert.deepEqual(clampBox(-5, -9, { vw: 1000, vh: 700 }), { x: 0, y: 0 });
  assert.deepEqual(defaultPosition({ playersRect: { left: 20, top: 500, width: 150 }, vw: 1200, vh: 800, w: 190, h: 24 }), { x: 20, y: 472 }, "just above the list");
  const f = defaultPosition({ playersRect: null, vw: 1200, vh: 800, w: 190, h: 24 }); assert.equal(f.x, 12); assert.ok(f.y < 800 - 48 && f.y > 600, "above the push-to-talk button");
  const doc = mkDoc(), win = { innerWidth: 1200, innerHeight: 800 };
  const b = new GmPingBadge({ doc, win, isGM: false, position: { x: 1100, y: 780 } }); b.mount();
  assert.equal(b.el.style.left, "1010px"); assert.equal(b.el.style.top, "776px", "saved spot pulled back on screen");
  win.innerWidth = 600; win.innerHeight = 400; b.place(); assert.equal(b.el.style.left, "410px"); assert.equal(b.el.style.top, "376px");
  const noList = new GmPingBadge({ doc: mkDoc(), win: { innerWidth: 1000, innerHeight: 700 }, position: null, playersRect: () => ({ left: 30, top: 400, width: 120 }) }); noList.mount();
  assert.equal(noList.el.style.left, "30px"); assert.equal(noList.el.style.top, "372px");
});

test("0.9.8 ping: dragging moves the badge and saves the spot; a drag is never a click; a small movement is a click; double-click resets", () => {
  const doc = mkDoc(), win = { innerWidth: 1000, innerHeight: 700 }; const log = [];
  const b = new GmPingBadge({ doc, win, isGM: true, position: { x: 100, y: 300 }, onMove: (p) => log.push(["move", p]), onReset: () => log.push(["reset"]) }); b.mount();
  b.set({ dot: "green", text: "AI GM · seen 1 s ago", lines: ["Status: listening"], title: "details", diagnostics: "diag" });
  const el = b.el;
  el.fire("pointerdown", { clientX: 110, clientY: 310, button: 0 }); doc.fire("pointermove", { clientX: 160, clientY: 340 }); doc.fire("pointerup", {}); el.fire("click", {});
  assert.deepEqual(log, [["move", { x: 150, y: 330 }]], "moved by (50, 30) and saved");
  assert.equal(el.style.left, "150px"); assert.equal(b.pop, null, "the click after a drag did not open the details");
  el.fire("pointerdown", { clientX: 160, clientY: 340, button: 0 }); doc.fire("pointermove", { clientX: 163, clientY: 342 }); doc.fire("pointerup", {}); el.fire("click", {});
  assert.equal(log.length, 1, "a 3 px wobble is not a drag"); assert.equal(b.pop?.dataset.open, "1", "it was a click: the GM details opened");
  el.fire("pointerdown", { clientX: 160, clientY: 340, button: 0 }); doc.fire("pointermove", { clientX: 5000, clientY: 5000 }); doc.fire("pointerup", {});
  assert.deepEqual(log.at(-1)[1], { x: 810, y: 676 }, "dragged off screen: clamped, never lost");
  el.fire("dblclick", {}); assert.equal(log.at(-1)[0], "reset"); assert.equal(b.position, null);
});

test("0.9.8 ping: players see only the line; the GM gets the details tooltip, the popup, Copy diagnostics and the eye hides it", () => {
  const model = { dot: "yellow", text: "AI GM · reply 18 s · seen 90 s ago", lines: ["Status: listening", "Undelivered events: 1"], title: "Status: listening\nUndelivered events: 1", diagnostics: "AI GM Pirate Borg diagnostics\nx" };
  const player = new GmPingBadge({ doc: mkDoc(), win: { innerWidth: 900, innerHeight: 600 }, isGM: false }); player.set(model);
  assert.equal(player.el.title, model.text, "no details for players"); assert.equal(player.el.dataset.dot, "yellow");
  player.el.fire("pointerdown", { clientX: 1, clientY: 1, button: 0 }); player.el.parentNode.fire?.("pointerup", {}); assert.equal(player.pop, null, "no popup for players");
  const calls = []; const doc = mkDoc();
  const gm = new GmPingBadge({ doc, win: { innerWidth: 900, innerHeight: 600 }, isGM: true, onCopy: (t) => calls.push(["copy", t]), onHide: () => calls.push(["hide"]), onReset: () => calls.push(["reset"]) }); gm.set(model);
  assert.equal(gm.el.title, model.title);
  gm.togglePopover(); assert.equal(gm.pop.querySelector(".aigm-ping-lines").textContent, "Status: listening\nUndelivered events: 1");
  gm.pop.fire("click", { target: { dataset: { act: "copy" } } }); gm.pop.fire("click", { target: { dataset: { act: "hide" } } }); gm.pop.fire("click", { target: { dataset: { act: "reset" } } });
  assert.deepEqual(calls, [["copy", model.diagnostics], ["hide"], ["reset"]]);
  gm.el.querySelector(".aigm-ping-eye").fire("click", {}); assert.equal(calls.at(-1)[0], "hide", "the eye icon hides it for this user");
  gm.hide(); assert.equal(gm.el.dataset.hidden, "1");
});

test("0.9.8 ping: both switches are real settings in Configure Settings (world for the GM, client for everyone), the position is hidden, and the strings exist", () => {
  const main = src("scripts/main.mjs"), lang = JSON.parse(src("lang/en.json"));
  assert.match(main, /register\(ID, "gmPingAllow", \{ scope: "world", config: true, restricted: true, type: Boolean, default: true/);
  assert.match(main, /register\(ID, "gmPingShow", \{ scope: "client", config: true, type: Boolean, default: true/);
  assert.match(main, /register\(ID, "gmStatusPosition", \{ scope: "client", config: false/);
  assert.match(main, /register\(ID, "gmPing", \{ scope: "world", config: false/);
  for (const k of ["gmPingAllow", "gmPingShow"]) { assert.ok(lang.AIGM.settings[k].name && lang.AIGM.settings[k].hint, k); assert.ok(ALL_KNOWN_KEYS.includes(k)); }
  assert.equal(lang.AIGM.settings.gmPingShow.name, "Show AI GM status in Players list"); assert.equal(lang.AIGM.settings.gmPingAllow.name, "Allow AI GM status row");
  assert.ok(CLIENT_KEYS.includes("gmPingShow")); assert.ok(CLIENT_KEYS.includes("gmStatusPosition")); assert.ok(HIDDEN_KEYS.includes("gmStatusPosition")); assert.ok(HIDDEN_KEYS.includes("gmPing"));
  assert.equal(groupFor("gmStatusPosition"), "hidden"); assert.equal(groupFor("gmPing"), "hidden");
  for (const k of ["gmPingAllow", "gmPingShow", "gmStatusPosition", "gmPing"]) assert.ok(ALL_KNOWN_KEYS.includes(k), k);
});

test("0.9.8 ping: passive by design: no new bot call, wake event, socket message or webhook post; shared numbers go in one throttled world setting", () => {
  const main = src("scripts/main.mjs"), g = src("scripts/lib/gmping.mjs");
  assert.doesNotMatch(g, /fetch\(|socket|emitEvent|XMLHttpRequest/, "the badge library makes no network call");
  const block = main.slice(main.indexOf("// ---------- 0.9.8 AI GM status badge"), main.indexOf("function refreshStatus()"));
  assert.doesNotMatch(block, /emitEvent|game\.socket\.emit|fetch\(|runCommand/, "the badge code sends nothing");
  assert.match(block, /createPublisher\(\{ write: \(snap\) => \{ try \{ game\.settings\.set\(ID, "gmPing", snap\)/);
  assert.match(main, /pingSeen\(\); \/\/ 0\.9\.8: any command the bot runs counts as "seen"/);
  assert.match(main, /REPLY_COMMANDS\.includes\(cmd\?\.name\)\) \{ S\.replyTimes\.reply/);
  assert.match(main, /takeBatch: \(\) => \{ pingSeen\(\)/); assert.match(main, /ack: \(eventIds\) => \{ thinkingOff\(\{ broadcast: true \}\); pingSeen\(\)/);
  assert.match(main, /S\.replyTimes\.openBatch\(/);
  assert.match(main, /if \(key === `\$\{ID\}\.gmPing`\) refreshPing\(\)/);
});

test("0.9.8 ping: docs mention the badge (setup prompt line, SETUP troubleshooting, README, CHANGELOG)", () => {
  const prompt = src("docs/bot-setup-prompt.md"), setup = src("docs/SETUP.md");
  assert.match(prompt, /Players list|AI GM status badge/i); assert.match(prompt, /answer .*2xx|2xx as soon as/i);
  assert.match(setup, /AI GM status badge/); assert.match(setup, /Troubleshooting/);
  assert.match(src("README.md"), /AI GM status badge/); assert.match(src("CHANGELOG.md"), /AI GM status badge/);
  assert.doesNotMatch(prompt + setup, /Kev\b|Kevin/);
});

test("0.9.8 prompt: every voice starts at once and the player's chosen voice is never dropped for speed; duplicates are skipped by id", () => {
  const p = src("docs/bot-setup-prompt.md");
  assert.match(p, /start every voice at once/); assert.match(p, /wait for each player's chosen voice/); assert.match(p, /Never drop a player's chosen voice just to post faster/);
  assert.doesNotMatch(p, /post when the default-voice clip is ready|rather than waiting for every player/i, "the old advice contradicts the new rule");
  assert.match(p, /Skip events you already answered/); assert.match(p, /Dedupe by that id/); assert.match(p, /two runs never answer the same line twice/);
  for (const f of ["docs/bot-setup-prompt.md", "docs/SETUP.md", "README.md"]) assert.doesNotMatch(src(f), /post without (all|every|waiting)|drop (a|the) (player's )?(chosen )?voice to (post|reply)|skip (the )?voices/i, `${f} promises nothing that skips voices`);
  assert.doesNotMatch(p, /Kev\b|Kevin|live\.js|pbtest|pb-test/i, "generic wording only");
});
