// 0.9.0 (beta): loot onto the sheet, Devil's Luck tracker, "GM, wait" hold, GM test fight, auto-unpause.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitLootText, cleanLootName, pickLootItemType, lootItemData, addLootItems } from "../scripts/lib/lootitems.mjs";
import { luckOf, planSpend, spendLuckLine, injectLuckTracker } from "../scripts/lib/devilsluck.mjs";
import { shouldAutoUnpause, autoUnpause } from "../scripts/lib/autounpause.mjs";
import { pickTestEnemy, planTestFight, testFightTokenData, TEST_ENEMY } from "../scripts/lib/testfight.mjs";
import { AudioQueue } from "../scripts/lib/audioqueue.mjs";
import { addHoldButton, enhanceVoiceMessage } from "../scripts/lib/voiceui.mjs";
import { parseLocal } from "../scripts/lib/local.mjs";
import { RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// tiny DOM
function el(tag) {
  const n = { nodeName: tag.toUpperCase(), nodeType: 1, children: [], childNodes: [], dataset: {}, style: {}, attrs: {}, listeners: {}, disabled: false, textContent: "", parentNode: null,
    className: "", classList: { toggle() { return true; } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(ev, f) { (this.listeners[ev] ||= []).push(f); },
    click() { for (const f of this.listeners.click || []) f({ preventDefault() {}, stopPropagation() {} }); },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); this.children = this.childNodes; return c; },
    get firstChild() { return this.childNodes[0] ?? null; },
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; },
    querySelector(sel) { return find(this, sel); } };
  return n;
}
function matches(n, sel) {
  if (sel.startsWith("[data-")) { const k = sel.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return k in n.dataset; }
  if (sel.startsWith(".")) return String(n.className).split(" ").includes(sel.slice(1));
  if (sel === "audio[src]") return n.nodeName === "AUDIO" && !!n.attrs.src;
  return n.nodeName === sel.toUpperCase();
}
function find(root, sel) {
  for (const s of sel.split(",").map(x => x.trim())) {
    const stack = [...root.childNodes];
    while (stack.length) { const n = stack.shift(); if (n.nodeType === 1 && matches(n, s.split(" ").at(-1))) return n; stack.push(...(n.childNodes || [])); }
  }
  return null;
}
const doc = { createElement: el };

test("0.9.0 #1 loot text: silver split off, a gold tooth becomes an item name", () => {
  assert.deepEqual(splitLootText("a gold tooth"), { silver: { amount: 0, formula: null }, itemName: "Gold tooth" });
  const mixed = splitLootText("2d10 silver and a gold tooth");
  assert.equal(mixed.silver.formula, "2d10"); assert.equal(mixed.itemName, "Gold tooth");
  assert.equal(splitLootText("15 silver").itemName, null);
  assert.equal(splitLootText("15 silver").silver.amount, 15);
  assert.equal(cleanLootName("Nothing"), null);
  assert.equal(cleanLootName("<b>An</b> old map."), "Old map");
});

test("0.9.0 #1 item type prefers misc, falls back sensibly; item data is flagged loot", () => {
  assert.equal(pickLootItemType(["weapon", "armor", "misc", "class"]), "misc");
  assert.equal(pickLootItemType(["class", "weapon"]), "weapon");
  assert.equal(pickLootItemType([]), "misc");
  const d = lootItemData("a gold tooth", { type: "misc", qty: 2 });
  assert.equal(d.name, "Gold tooth"); assert.equal(d.type, "misc"); assert.equal(d.system.quantity, 2);
  assert.equal(d.flags["ai-gm-bridge"].loot, true);
});

test("0.9.0 #1 addLootItems writes to the actor it is given (linked actor or token actor)", async () => {
  globalThis.game = { documentTypes: { Item: ["misc", "weapon"] } };
  const made = [];
  const tokenActor = { id: "tA", createEmbeddedDocuments: async (k, d) => { made.push([k, d]); return d; } };
  const names = await addLootItems(tokenActor, ["a gold tooth", "nothing"]);
  assert.deepEqual(names, ["Gold tooth"]);
  assert.equal(made[0][0], "Item"); assert.equal(made[0][1][0].type, "misc");
  assert.deepEqual(await addLootItems(tokenActor, []), []);
});

test("0.9.0 #1 table loot: text results and unlinked item results land on the sheet", () => {
  const c = src("scripts/commands.mjs");
  assert.match(c, /splitLootText\(text\)/);
  assert.match(c, /loose\.push\(it\.name\)/);
  assert.match(c, /addLootItems\(actor, loose\)/);
  assert.match(c, /giveItem: \{ schema/);
});

test("0.9.0 #2 Devil's Luck: value, spend plan, chat line", () => {
  assert.equal(luckOf({ type: "character", system: { attributes: { luck: { value: 3 } } } }), 3);
  assert.equal(luckOf({ type: "creature", system: {} }), null);
  assert.deepEqual(planSpend(2), { before: 2, after: 1 });
  assert.ok(planSpend(0).error);
  assert.equal(spendLuckLine("Tempus", 2, 1), "Tempus spends a Devil's Luck (2 → 1).");
});

test("0.9.0 #2 sheet tracker shows the value; Spend is one click per spend and off at 0 or for non-owners", async () => {
  const actor = { id: "a1", type: "character", system: { attributes: { luck: { value: 2 } } } };
  const root = el("div"); const form = el("form"); root.appendChild(form);
  let spends = 0; let release;
  const bar = injectLuckTracker(root, { actor, canSpend: true, doc, onSpend: () => { spends++; return new Promise(r => { release = r; }); } });
  assert.ok(bar);
  assert.equal(bar.querySelector(".aigm-luck-value").textContent, "2");
  const btn = bar.querySelector(".aigm-luck-spend");
  btn.click(); btn.click();
  assert.equal(spends, 1);
  actor.system.attributes.luck.value = 1; release(); await new Promise(r => setTimeout(r, 0));
  assert.equal(btn.disabled, false);
  assert.equal(bar.querySelector(".aigm-luck-value").textContent, "1");
  actor.system.attributes.luck.value = 0;
  injectLuckTracker(root, { actor, canSpend: true, doc });
  assert.equal(btn.disabled, true);
  const root2 = el("div");
  const bar2 = injectLuckTracker(root2, { actor: { ...actor, system: { attributes: { luck: { value: 3 } } } }, canSpend: false, doc });
  assert.equal(bar2.querySelector(".aigm-luck-spend").disabled, true);
  assert.equal(injectLuckTracker(el("div"), { actor: { type: "creature" }, doc }), null);
});

test("0.9.0 #2 spendLuck uses the setResource path and posts one chat line", async () => {
  const c = src("scripts/commands.mjs");
  assert.match(c, /spendLuck: \{ schema/);
  assert.match(c, /writeResource\(tg, \{ resource: "luck", delta: -n \}\)/); // 0.9.1: same write as setResource, on the resolved actor
  assert.match(c, /setResource: \{[^]*?return writeResource\(tg, a\);/);
  assert.match(c, /spendLuckLine\(actor\.name/);
  const m = src("scripts/main.mjs");
  assert.match(m, /renderActorSheetV2/);
  assert.match(m, /name: "spendLuck"/);
});

test("0.9.0 #3 hold stops the clip playing now, drops waiting clips, and never replays them", async () => {
  const played = []; let stopCalls = 0; let finish;
  const q = new AudioQueue({ gapMs: 0, sleep: async () => {}, play: (clip) => new Promise(r => { played.push(clip.src); finish = r; }), stop: () => { stopCalls++; finish?.(); return true; } });
  const a = q.enqueue("voice:m1", { src: "a.mp3" });
  const b = q.enqueue("voice:m2", { src: "b.mp3" });
  const rep = q.replay({ src: "a.mp3" });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(played, ["a.mp3"]);
  const h = q.hold();
  assert.equal(h.stopped, true); assert.equal(h.dropped, 2); assert.equal(stopCalls, 1);
  assert.deepEqual(await a, { id: "voice:m1", played: true, held: true });
  assert.equal((await b).held, true);
  assert.equal((await rep).held, true); // a waiting ▶ replay resolves, so its button comes back
  // a late socket copy of a dropped line is a duplicate, not a second play
  assert.equal((await q.enqueue("voice:m2", { src: "b.mp3" })).duplicate, true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(played, ["a.mp3"]);
  // the next new GM line plays normally
  const c = q.enqueue("voice:m3", { src: "c.mp3" });
  await new Promise(r => setTimeout(r, 0)); finish();
  assert.equal((await c).played, true);
  assert.deepEqual(played, ["a.mp3", "c.mp3"]);
  // nothing playing: hold is a no-op
  assert.deepEqual(q.hold(), { stopped: false, dropped: 0, id: null });
});

test("0.9.0 #3 'GM, wait' button: one hold per click, cooldown, never touches replay", () => {
  const parent = el("div"); const replay = el("button"); parent.appendChild(replay);
  const calls = []; let timer;
  const b = addHoldButton(doc, replay, { msg: { id: "m9" }, hold: (x) => calls.push(x), setTimer: (f) => { timer = f; } });
  assert.equal(b.textContent, "GM, wait");
  assert.equal(replay.nextSibling, b);
  b.click(); b.click();
  assert.deepEqual(calls, [{ messageId: "m9" }]);
  assert.equal(b.disabled, true); timer(); assert.equal(b.disabled, false);
});

test("0.9.0 #3 voice line gets ▶ and GM, wait; the replay guard still holds", async () => {
  const root = el("div"); const audio = el("audio"); audio.setAttribute("src", "v.mp3"); root.appendChild(audio);
  root.ownerDocument = doc;
  let replays = 0, release; const holds = [];
  const okd = enhanceVoiceMessage({ id: "m1", content: "Ahoy" }, root, { slug: "ryan", replay: () => { replays++; return new Promise(r => { release = r; }); }, hold: (x) => holds.push(x) });
  assert.equal(okd, true);
  const rp = root.querySelector("[data-aigm-replay]"); const hb = root.querySelector("[data-aigm-hold]");
  assert.ok(rp && hb);
  rp.click(); rp.click(); assert.equal(replays, 1); assert.equal(rp.disabled, true);
  hb.click(); assert.equal(holds.length, 1); assert.equal(replays, 1);
  release(); await new Promise(r => setTimeout(r, 0)); assert.equal(rp.disabled, false);
  // bot page: no hold button
  const r2 = el("div"); const a2 = el("audio"); a2.setAttribute("src", "v.mp3"); r2.appendChild(a2); r2.ownerDocument = doc;
  enhanceVoiceMessage({ id: "m2", content: "x" }, r2, { slug: "ryan", replay: () => {} });
  assert.equal(r2.querySelector("[data-aigm-hold]"), null);
});

test("0.9.0 #3 hold goes out as one socket message and one bot event (auto-acked in relay mode)", () => {
  const m = src("scripts/main.mjs");
  assert.match(m, /data\.type === "hold"\) return void onHold\(data\)/);
  assert.match(m, /type: "hold", author:/);
  assert.match(m, /hold: isBot\(\) \? null : sendHold/);
  assert.ok(RELAY_AUTO_ACK_TYPES.includes("hold"));
  assert.doesNotMatch(m + src("scripts/commands.mjs") + src("scripts/lib/voiceui.mjs"), /speechSynthesis\.speak/);
});

test("0.9.0 #4 test fight: enemy pick, placement next to the party, hostile unlinked tokens", () => {
  const rat = { id: "r", name: "Bilge Rat", type: "creature" };
  const actors = [{ id: "p", name: "Tempus", type: "character" }, { id: "g", name: "Ghoul", type: "creature" }, rat];
  assert.equal(pickTestEnemy(actors), rat);
  assert.equal(pickTestEnemy(actors, "ghoul").id, "g");
  assert.equal(pickTestEnemy(actors, "Nope"), null);
  assert.equal(pickTestEnemy([]), null);
  assert.equal(TEST_ENEMY.type, "creature");
  const plan = planTestFight({ count: 3, scene: { grid: { size: 100 } }, pcTokens: [{ x: 500, y: 400 }] });
  assert.equal(plan.count, 3);
  assert.deepEqual(plan.spots, [{ x: 700, y: 400 }, { x: 800, y: 400 }, { x: 900, y: 400 }]);
  assert.equal(planTestFight({ count: 99 }).count, 6);
  const t = testFightTokenData({ name: "Bilge Rat", actorId: "r" }, 1, plan.spots[1], "tf1");
  assert.equal(t.name, "Bilge Rat 2"); assert.equal(t.disposition, -1); assert.equal(t.actorLink, false);
  assert.equal(t.flags["ai-gm-bridge"].testFight, "tf1");
  assert.deepEqual(parseLocal("!testfight 4 Bilge Rat"), { name: "testFight", args: { count: 4, enemy: "Bilge Rat" } });
});

test("0.9.0 #4 testFight is GM-only, sets Calm, starts combat", () => {
  const c = src("scripts/commands.mjs");
  assert.match(c, /testFight is GM-only/);
  assert.match(c, /COMMANDS\.setMood\.run\(\{ mood: a\.mood \|\| "Calm" \}\)/);
  assert.match(c, /await combat\.startCombat\(\)/);
  assert.match(src("scripts/main.mjs"), /"testFight", "giveItem"\]\.includes\(cmd\.name\)/);
});

test("0.9.0 #5 auto-unpause rules: only during play, never on world load, setting off keeps it paused", () => {
  const base = { enabled: true, paused: true, aiPaused: false, ready: true, isGM: true };
  for (const reason of ["mapBuild", "combatStart", "combatTurn", "testFight"]) assert.equal(shouldAutoUnpause({ ...base, reason }), true, reason);
  assert.equal(shouldAutoUnpause({ ...base, reason: "worldLoad" }), false);
  assert.equal(shouldAutoUnpause({ ...base, reason: "ready" }), false);
  assert.equal(shouldAutoUnpause({ ...base, reason: null }), false);
  assert.equal(shouldAutoUnpause({ ...base, enabled: false, reason: "combatStart" }), false);
  assert.equal(shouldAutoUnpause({ ...base, aiPaused: true, reason: "combatStart" }), false);
  assert.equal(shouldAutoUnpause({ ...base, paused: false, reason: "combatStart" }), false);
  assert.equal(shouldAutoUnpause({ ...base, isGM: false, reason: "combatStart" }), false);
});

test("0.9.0 #5 autoUnpause toggles Foundry pause with broadcast, honours the setting", () => {
  const calls = []; const store = { autoUnpause: true, aiPaused: false };
  const g = { paused: true, ready: true, user: { isGM: true }, settings: { get: (m, k) => store[k] }, togglePause: (v, o) => { calls.push([v, o]); g.paused = v; } };
  assert.equal(autoUnpause("combatStart", g).unpaused, true);
  assert.deepEqual(calls, [[false, { broadcast: true }]]);
  g.paused = true; store.autoUnpause = false;
  assert.equal(autoUnpause("combatStart", g).unpaused, false); assert.equal(g.paused, true);
  store.autoUnpause = true; store.aiPaused = true;
  assert.equal(autoUnpause("mapBuild", g).unpaused, false);
});

test("0.9.0 #5 wired into map builds, combat start and turns; setting registered default on; not on ready", () => {
  const c = src("scripts/commands.mjs"); const m = src("scripts/main.mjs");
  assert.ok((c.match(/autoUnpause\("mapBuild"\)/g) || []).length >= 3);
  assert.match(c, /autoUnpause\("combatTurn"\)/);
  assert.match(c, /autoUnpause\("combatStart"\)/);
  assert.match(m, /register\(ID, "autoUnpause", \{ scope: "world", config: true, restricted: true, type: Boolean, default: true/);
  assert.match(m, /autoUnpause\(startedNow\(c, change\) \? "combatStart" : "combatTurn"\)/);
  const ready = m.slice(m.indexOf('Hooks.once("ready"'), m.indexOf('Hooks.once("ready"') + 4000);
  assert.doesNotMatch(ready, /autoUnpause\(/);
  const lang = JSON.parse(src("lang/en.json"));
  assert.ok(lang.AIGM.settings.autoUnpause.name && lang.AIGM.voice.hold && lang.AIGM.luck.spend);
});

test("0.9.0 version, beta label, credit, voices", () => {
  const mod = JSON.parse(src("module.json"));
  assert.equal(mod.version, "0.9.5");
  assert.equal(JSON.parse(src("package.json")).version, "0.9.5");
  assert.match(src("CHANGELOG.md"), /## 0\.9\.0/);
  assert.match(src("README.md"), /0\.9\.0/);
  const all = ["module.json", "README.md", "CHANGELOG.md", "scripts/commands.mjs", "scripts/main.mjs"].map(src).join("\n");
  assert.doesNotMatch(all, /\bKev(in)?\b|\bAllen\b/);
  assert.match(src("scripts/lib/voices.mjs"), /en-GB-RyanNeural/);
});
