// 0.8.9: relay mode acks chat after it is handed to the GM, so old chat stops re-sending.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Outbox, relayAutoAckIds, relayStaleChatIds, RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";
import { resolveWakeEventIds, newestChatEventIds, collectHp, sceneTokens, panelHtml } from "../scripts/lib/gmpanel.mjs";
import { recap, recapStamp } from "../scripts/lib/sessionlog.mjs";

test("0.8.9 relayAutoAckIds includes chat, never control, and skips incomplete events", () => {
  assert.ok(RELAY_AUTO_ACK_TYPES.includes("chat"));
  assert.ok(!RELAY_AUTO_ACK_TYPES.includes("control"));
  const ids = relayAutoAckIds([
    { eventId: "chat:a", type: "chat" },
    { eventId: "control:pause:1", type: "control" },
    { eventId: "combat:x:start", type: "combat" },
    { eventId: "rollreq:1", type: "rollResult" },
    { eventId: "rollreq:1:cancel", type: "rollCancelled" },
    { type: "chat" },
    { eventId: "chat:b" },
    null
  ]);
  assert.ok(ids.includes("chat:a"));
  assert.ok(!ids.includes("control:pause:1"));
  assert.ok(!ids.includes("chat:b"));
});

test("0.8.9 relayStaleChatIds is already-flushed chat only", () => {
  const items = [
    { event: { eventId: "chat:old", type: "chat" }, attempts: 2 },
    { event: { eventId: "chat:fresh", type: "chat" }, attempts: 0 },
    { event: { eventId: "control:x", type: "control" }, attempts: 3 },
    { event: { eventId: "chat:dead", type: "chat" }, attempts: 8 }
  ];
  assert.deepEqual(relayStaleChatIds(items).sort(), ["chat:dead", "chat:old"]);
  assert.deepEqual(relayStaleChatIds([]), []);
});

test("0.8.9 acking chat ids from a mixed batch leaves other types queued", () => {
  const o = new Outbox();
  o.enqueue({ eventId: "chat:a", type: "chat" }, 0);
  o.enqueue({ eventId: "control:1", type: "control", action: "pause" }, 0);
  const b = o.nextBatch(0, "w");
  const ids = relayAutoAckIds(b.events);
  assert.deepEqual(ids, ["chat:a"]);
  assert.equal(o.ack(ids), 1);
  assert.deepEqual(o.items.map(i => i.event.eventId), ["control:1"]);
  assert.ok(o.items[0].attempts > 0);
  const stale = relayStaleChatIds([{ event: { eventId: "chat:a", type: "chat" }, attempts: 1 }, ...o.items]);
  assert.deepEqual(stale, ["chat:a"]);
});

test("0.8.9 redo/skip wake ids prefer lastWake, then requested, then newest player chat", () => {
  assert.deepEqual(resolveWakeEventIds({ eventIds: ["chat:keep"] }, ["chat:req"], ["chat:fb"]), ["chat:keep"]);
  assert.deepEqual(resolveWakeEventIds({ eventIds: [] }, ["chat:req"], ["chat:fb"]), ["chat:req"]);
  assert.deepEqual(resolveWakeEventIds(null, [], () => ["chat:fb"]), ["chat:fb"]);
  const msgs = [
    { id: "old", flags: {} },
    { id: "bot1", flags: {} },
    { id: "local1", flags: { "ai-gm-bridge": { local: true } } },
    { id: "mid" },
    { id: "newest" }
  ];
  assert.deepEqual(newestChatEventIds(msgs, { limit: 2, skip: (m) => m.id === "bot1" || m.flags?.["ai-gm-bridge"]?.local }), ["chat:newest", "chat:mid"]);
  assert.deepEqual(newestChatEventIds(msgs, { limit: 1 }), ["chat:newest"]);
  assert.deepEqual(newestChatEventIds([{ id: "chat:already" }], { limit: 1 }), ["chat:already"]);
});

test("0.8.9 main wiring: relay acks chat after emit without thinkingOff; direct unchanged", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /import \{ Outbox, relayAutoAckIds, relayStaleChatIds \}/);
  assert.match(m, /if \(get\("delivery"\) === "relay"\) ackRelayChatIds\(relayAutoAckIds\(payload\.events\)\)/);
  assert.match(m, /function ackRelayChatIds/);
  assert.match(m, /function ackRelayStaleChat/);
  assert.match(m, /ackRelayStaleChat\(\)/);
  assert.match(m, /function wakeTargetIds/);
  assert.match(m, /newestChatEventIds/);
  // explicit api.ack still clears thinking; the relay chat path must not
  assert.match(m, /ack: \(eventIds\) => \{ thinkingOff\(\{ broadcast: true \}\)/);
  assert.doesNotMatch(m, /ackRelayChatIds\([^\n]*thinkingOff/);
  assert.match(m, /get\("delivery"\) === "direct" && isBot\(\) && get\("webhookUrl"\)/);
});

test("0.8.9 version, changelog and public credits", () => {
  const ver = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")).version;
  assert.match(ver, /^0\.8\.\d+$/);
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, ver);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.9/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, new RegExp(`v${ver.replaceAll(".", "\\.")}`));
  assert.match(readme, /Gate \(GateShark\)/);
  assert.doesNotMatch(readme, /Kevin|Allen/);
  assert.match(readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8"), /v0\.8\.9/);
});

test("0.8.9 panel HP comes from scene tokens (unlinked HP, including 0; no off-scene actors)", () => {
  const baseTempus = { id: "tempus", name: "Tempus", hasPlayerOwner: true, system: { attributes: { hp: { value: 10, max: 10 } } } };
  const tokens = [
    { id: "tok-tempus", name: "Tempus", actorLink: false, actor: { ...baseTempus, system: { attributes: { hp: { value: 2, max: 10 } } } } },
    { id: "tok-skel", name: "Skeleton", actorLink: false, actor: { id: "skel", name: "Skeleton", hasPlayerOwner: false, system: { attributes: { hp: { value: 0, max: 4 } } } } }
  ];
  const hp = collectHp(tokens);
  assert.deepEqual(hp.map(h => [h.name, h.value, h.max]), [["Tempus", 2, 10], ["Skeleton", 0, 4]]);
  assert.ok(!hp.some(h => h.name === "Bilge Rats"));
  const html = panelHtml({ hp });
  assert.match(html, /2\/10/);
  assert.match(html, /0\/4/);
  assert.match(html, /aigm-hp-dead/);
  assert.deepEqual(sceneTokens({ tokens: { contents: tokens } }).map(t => t.id), ["tok-tempus", "tok-skel"]);
  assert.deepEqual(sceneTokens({ tokens }).map(t => t.id), ["tok-tempus", "tok-skel"]);
  assert.deepEqual(sceneTokens(null), []);
  // off-scene actor is not passed in, so it cannot appear
  const onlyScene = collectHp(sceneTokens({ tokens: { contents: tokens } }));
  assert.equal(onlyScene.length, 2);
});

test("0.8.9 main refreshes an open panel on roll-request chat changes and reads scene tokens", () => {
  const m = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(m, /sceneTokens\(scene\)/);
  assert.match(m, /collectHp\(tokens/);
  assert.match(m, /function refreshPanel/);
  assert.match(m, /msg\.flags\?\.\[ID\]\?\.rollRequest\) refreshPanel\(\)/);
  assert.match(m, /Hooks\.on\("updateChatMessage"/);
  assert.match(m, /Hooks\.on\("createChatMessage"/);
  assert.match(m, /Hooks\.on\("deleteChatMessage"/);
  const cfg = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.match(cfg, /delivery: "Delivery"/);
  assert.match(cfg, /webhookUrl: "Webhook URL"/);
});

test("0.8.9 settings i18n names/hints for delivery, webhookUrl, botNames, webhookAuthHeader", () => {
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  for (const k of ["delivery", "webhookUrl", "botNames", "webhookAuthHeader"]) {
    assert.ok(en.settings[k]?.name, k);
    assert.ok(!String(en.settings[k].name).includes("AIGM."), k);
    assert.ok(en.settings[k].hint, k);
  }
  assert.equal(en.settings.delivery.name, "Delivery");
  assert.equal(en.settings.webhookUrl.name, "Webhook URL");
  assert.equal(en.settings.botNames.name, "Bot names");
  assert.equal(en.settings.webhookAuthHeader.name, "Webhook auth header");
});

test("0.8.9 recap is newest-first with Today/Yesterday or date plus time", () => {
  const now = new Date(2026, 10, 9, 22, 0, 0).getTime();
  const today = new Date(2026, 10, 9, 7, 59, 0).getTime();
  const yest = new Date(2026, 10, 8, 12, 0, 0).getTime();
  const older = new Date(2026, 10, 7, 8, 0, 0).getTime();
  assert.equal(recapStamp(today, now), "Today 07:59:00");
  assert.equal(recapStamp(yest, now), "Yesterday 12:00:00");
  assert.equal(recapStamp(older, now), "2026-11-07 08:00:00");
  const r = recap([
    { at: older, kind: "heal", text: "oldest" },
    { at: yest, kind: "heal", text: "yesterday-line" },
    { at: today, kind: "heal", text: "today-line" }
  ], { max: 2, now });
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0], "[Today 07:59:00] today-line");
  assert.equal(r.lines[1], "[Yesterday 12:00:00] yesterday-line");
  assert.ok(!r.lines.join("\n").includes("oldest"));
});
