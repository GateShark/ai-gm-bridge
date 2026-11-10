// 0.8.9: relay mode acks chat after it is handed to the GM, so old chat stops re-sending.
import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Outbox, relayAutoAckIds, relayStaleChatIds, RELAY_AUTO_ACK_TYPES } from "../scripts/lib/outbox.mjs";
import { resolveWakeEventIds, newestChatEventIds } from "../scripts/lib/gmpanel.mjs";

test("0.8.9 relayAutoAckIds is chat-only and skips incomplete events", () => {
  assert.deepEqual(RELAY_AUTO_ACK_TYPES, ["chat"]);
  assert.deepEqual(relayAutoAckIds([
    { eventId: "chat:a", type: "chat" },
    { eventId: "control:pause:1", type: "control" },
    { eventId: "combat:x:start", type: "combat" },
    { eventId: "rollreq:1", type: "rollResult" },
    { eventId: "rollreq:1:cancel", type: "rollCancelled" },
    { type: "chat" },
    { eventId: "chat:b" },
    null
  ]), ["chat:a"]);
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
  assert.equal(ver, "0.8.9");
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, "0.8.9");
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.9/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /v0\.8\.9/);
  assert.match(readme, /Gate \(GateShark\)/);
  assert.doesNotMatch(readme, /Kevin|Allen/);
  assert.match(readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8"), /v0\.8\.9/);
});
