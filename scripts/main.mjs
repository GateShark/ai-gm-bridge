// AI GM Bridge v0.8.0-rc2 — entry point (bot-agnostic). Does nothing unless world setting `enabled` is true.
import { decideLeader, applyHeartbeat } from "./lib/leader.mjs";
import { DedupeStore } from "./lib/dedupe.mjs";
import { Outbox } from "./lib/outbox.mjs";
import { classify } from "./lib/filter.mjs";
import { Batcher } from "./lib/batcher.mjs";
import { parseLocal } from "./lib/local.mjs";
import { isOwn as isOwnShipCard } from "./lib/ship.mjs";
import { buildPayload } from "./lib/compact.mjs";
import { VoiceCache } from "./lib/voicecache.mjs";
import { Metrics } from "./lib/metrics.mjs";
import { deliverDirect } from "./lib/direct.mjs";
import { makeConfigApp } from "./config-app.mjs";
import { fail } from "./lib/result.mjs";
import { runCommand, COMMANDS, onVoiceSocket } from "./commands.mjs";
import { missedMessages } from "./lib/replies.mjs";
import { lockBlocks } from "./lib/spawn.mjs";
import { burstTest } from "./lib/bursttest.mjs";
import { formatResult } from "./lib/v081.mjs";
import * as F from "./features.mjs";
import { getContext } from "./context.mjs";
import { cleanupContextJournals } from "./gmstore.mjs";
import { turnText } from "./lib/turns.mjs";
import { ThinkingIndicator, shouldShowThinking } from "./lib/thinking.mjs";

const ID = "ai-gm-bridge"; const SOCKET = `module.${ID}`;
const S = { leader: null, dedupe: null, outbox: null, timers: [], lastBatch: null, batcher: null, voice: null, metrics: new Metrics(), ackedCtx: null, sent: new Map() };
const list = (k) => String(get(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
const get = (k) => game.settings.get(ID, k);
const enabled = () => !!get("enabled");
const isBot = (u = game.user) => u.id === get("botUserId") || (!get("botUserId") && !!get("botUserName") && u.name?.toLowerCase().startsWith(get("botUserName").toLowerCase()));
const amLeader = () => S.leader?.leaderId === game.user.id;
// #14: one pill per client; label is localized when shown.
const thinking = new ThinkingIndicator({ label: () => game.i18n?.localize?.("AIGM.thinking") || "GM is thinking…" });
function thinkingOn() { if (!get("thinkingIndicator")) return; const ms = get("thinkingTimeoutMs"); thinking.show(ms); game.socket.emit(SOCKET, { type: "thinking", on: true, timeoutMs: ms }); }
function thinkingOff({ broadcast = false } = {}) { thinking.hide(); if (broadcast) game.socket.emit(SOCKET, { type: "thinking", on: false }); }
const log = (...a) => console.log(`${ID} |`, ...a);

Hooks.once("init", () => {
  const reg = (k, type, def, extra = {}) => game.settings.register(ID, k, { scope: "world", config: true, restricted: true, type, default: def,
    name: `AIGM.settings.${k}.name`, hint: `AIGM.settings.${k}.hint`, ...extra });
  reg("enabled", Boolean, false, { onChange: () => restart() });
  reg("botUserId", String, "", { config: false }); reg("botUserName", String, "");
  reg("botNames", String, "gm, ai gm", { config: false });
  reg("delivery", String, "relay", { config: false, choices: { relay: "relay", direct: "direct" } });
  reg("webhookUrl", String, "", { config: false }); reg("webhookAuthHeader", String, "Authorization", { config: false });
  game.settings.register(ID, "webhookSecret", { scope: "world", config: false, restricted: true, type: String, default: "" });
  game.settings.registerMenu(ID, "config", { name: "AI GM Bridge", label: "Configure AI GM", icon: "fas fa-robot", type: makeConfigApp(), restricted: true });
  reg("heartbeatMs", Number, 10000); reg("heartbeatTimeoutMs", Number, 45000); reg("batchMs", Number, 3500);
  reg("keywords", String, ""); reg("hpPath", String, "system.hp.value");
  reg("alwaysVoiceUsers", String, ""); reg("unpauseOnStart", Boolean, true);
  // v0.3 speed/usage
  reg("debounceMs", Number, 1200); reg("maxWaitMs", Number, 3500);
  reg("wakeOn", String, "mention,whisper,keyword,question,ic"); reg("ignoreOOC", Boolean, true); reg("ignorePlainRolls", Boolean, true);
  reg("ignoreUsers", String, ""); reg("minChars", Number, 2);
  reg("localCommands", Boolean, true); reg("localPrefix", String, "!");
  reg("maxTextChars", Number, 400); reg("ttsMinChars", Number, 0); reg("metricsLogEvery", Number, 10);
  // v0.4
  reg("uploadsEnabled", Boolean, true); reg("uploadMaxMB", Number, 8); reg("uploadTypes", String, "png,jpg,jpeg,webp,gif,mp3,ogg,wav,webm,txt,md,json");
  // v0.6
  reg("speakerAlias", String, "AI GM"); reg("rollRequestTimeoutMs", Number, 120000); reg("rollRequestExpireMs", Number, 600000); reg("rollAnswerNote", Boolean, true);
  reg("turnPrompts", Boolean, true); reg("turnWake", Boolean, false); reg("turnVoiceUsers", String, "");
  reg("sessionLog", Boolean, true);
  // v0.8 house rule: pirateborg v1.9.0 ram ignores the target armour roll; on = subtract it
  reg("ramUsesArmor", Boolean, false);
  // v0.8.2 #14 "GM is thinking…" indicator
  reg("thinkingIndicator", Boolean, true); reg("thinkingTimeoutMs", Number, 90000);
  // v0.7 (GM-only: world setting, config menu is GM-only)
  // v0.7.0 stored the context journal list here. Kept hidden (config:false) only so v0.7.2 can clear it; never written otherwise.
  game.settings.register(ID, "contextJournals", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(ID, "voiceCache", { scope: "world", config: false, type: Object, default: { entries: [] } });
  game.settings.register(ID, "dedupeState", { scope: "world", config: false, type: Object, default: { entries: [] } });
  game.settings.register(ID, "outboxState", { scope: "world", config: false, type: Object, default: { items: [], seq: 0 } });
});

Hooks.once("ready", () => {
  const mod = game.modules.get(ID);
  mod.api = {
    version: mod.version, commands: Object.keys(COMMANDS),
    status: () => ({ enabled: enabled(), leader: S.leader, amLeader: amLeader(), queued: S.outbox?.items.length ?? 0, dead: S.outbox?.dead().length ?? 0,
      deadIds: S.outbox?.dead().map(i => i.event.eventId) ?? [] }),
    metrics: () => S.metrics.snapshot(),
    format: (r) => formatResult(r),
    debug: { burstTest: (o = {}) => burstTest({ debounceMs: get("debounceMs"), maxWaitMs: get("maxWaitMs"), ...o }) },
    clearDead: () => { const ids = S.outbox?.clearDead() ?? []; persistSoon(); return { ok: true, result: { cleared: ids } }; },
    run: async (cmd) => {
      if (!enabled()) return fail(503, "AI GM bridge disabled in this world");
      if (!game.user.isGM || !isBot()) return fail(403, "commands only accepted from the bot GM user");
      if (!amLeader()) return fail(421, "not leader", { leader: S.leader?.leaderId ?? null });
      if (cmd?.commandId) { if (!S.dedupe.claim(`cmd:${cmd.commandId}`, Date.now())) { const e = S.dedupe.get(`cmd:${cmd.commandId}`); const done = e?.s === "acked";
          return fail(409, done ? "already done" : "in progress", { alreadyDone: done, prior: e?.res ?? null }); } await persistNow(); }
      thinkingOff({ broadcast: true }); // #14: any bot action ends the wait
      const res = await runCommand(cmd, ctxFor());
      const rt = cmd?.args?.replyTo && game.messages?.get(String(cmd.args.replyTo).replace(/^chat:/, ""))?.timestamp;
      if (res.ok && rt) S.metrics.time("reply", Date.now() - rt);
      if (cmd?.commandId) S.dedupe.mark(`cmd:${cmd.commandId}`, res.ok ? "acked" : "failed", Date.now(), { res }); persistSoon();
      return res;
    },
    ack: (eventIds) => { onAcked(eventIds); const n = S.outbox?.ack(eventIds) ?? 0; S.metrics.inc("acked", n); for (const id of eventIds) S.dedupe?.mark(id, "acked", Date.now()); persistSoon(); return { ok: true, result: { acked: n } }; },
    // GM-only, returned to the caller only. Players get 403 and nothing is sent anywhere.
    context: (o = {}) => getContext(game, o),
    turnStatus: () => F.turnStatus(), recap: (o) => F.recap(o),
    takeBatch: () => S.lastBatch, // relay stub can poll this on the headless client
  };
  game.socket.on(SOCKET, onSocket);
  if (game.user.isGM && game.users.activeGM?.id === game.user.id) cleanupContextJournals(game).then(r => r.cleared && log("v0.7.2: the context journal list is no longer stored in the world (players could read it). Set AIGM_CONTEXT_JOURNALS on the relay or pass journals per getContext call. Old value:", r.old)).catch(e => log("migrate", e?.message));
  F.initFeatures({ get, amLeader, log, voice: (t) => S.voice?.get(t) ?? null, emit: emitEvent });
  restart();
});

function ctxFor() {
  return { dedupe: S.dedupe, persistNow, ack: (ids) => game.modules.get(ID).api.ack(ids), voiceCache: S.voice, ttsMinChars: get("ttsMinChars"),
    metrics: S.metrics, persistVoice: () => { clearTimeout(S.vt); S.vt = setTimeout(() => game.settings.set(ID, "voiceCache", { entries: S.voice.toJSON() }), 3000); } };
}
// Ack bookkeeping: ack latency per batch, and remember the ctx the bot has definitely seen (payload ctx is a diff against it).
function onAcked(eventIds) {
  const s = new Set(eventIds);
  for (const [bid, b] of S.sent) if (b.ids.every(id => s.has(id))) { S.metrics.time("ack", Date.now() - b.at); S.ackedCtx = b.ctx; S.sent.delete(bid); }
}
function stop() { S.timers.forEach(clearInterval); S.timers = []; S.batcher?.stop(); }
function restart() {
  stop();
  if (!enabled() || !game.user.isGM) return log("idle (disabled or not GM)");
  S.dedupe = new DedupeStore({ entries: get("dedupeState")?.entries ?? [] });
  const ob = get("outboxState") ?? {}; S.outbox = new Outbox({ items: ob.items ?? [], seq: ob.seq ?? 0 });
  S.voice = new VoiceCache({ entries: get("voiceCache")?.entries ?? [] });
  S.outbox.purgeDead(Date.now());
  // Heartbeat is the only interval (leader liveness needs it). Flushes are event-driven: debounced chat bursts + retry wake-ups.
  S.timers.push(setInterval(tickLeader, get("heartbeatMs")));
  S.batcher = new Batcher({ debounceMs: get("debounceMs"), maxWaitMs: get("maxWaitMs"), onFlush: (o) => flush(o) });
  if (S.outbox.items.some(i => i.attempts === 0)) S.batcher.push(); // unsent events from before a reload
  S.batcher.at(S.outbox.nextDueAt());
  tickLeader();
  F.seedSnapshots();
}
// v0.6: one feature event into the outbox (idempotent by eventId).
function emitEvent(ev, { urgent = false } = {}) {
  if (!enabled() || !amLeader() || !S.outbox) return false; const now = Date.now();
  if (!S.dedupe.claim(ev.eventId, now)) return false;
  S.outbox.enqueue(ev, now); S.dedupe.mark(ev.eventId, "sent", now); persistNow(); S.metrics.inc("woke"); S.batcher?.push({ urgent, at: now }); return true;
}

function tickLeader() {
  const now = Date.now(); S.batcher?.check();
  const d = decideLeader({ now, selfId: game.user.id, selfIsBot: isBot(), selfIsGM: game.user.isGM, state: S.leader, timeoutMs: get("heartbeatTimeoutMs") });
  if (d.action === "passive") return;
  const wasLeader = amLeader();
  const hb = { type: "heartbeat", userId: game.user.id, isBot: isBot(), term: d.term };
  S.leader = applyHeartbeat(S.leader, hb, now);
  game.socket.emit(SOCKET, hb);
  if (!wasLeader && amLeader()) { catchUp(); F.rearmRollRequests(); }
}

// New leader: reload persisted dedupe (another GM may have written it) and handle recent chat it never saw.
function catchUp() {
  S.dedupe = new DedupeStore({ entries: get("dedupeState")?.entries ?? [] });
  const ob = get("outboxState") ?? {}; S.outbox = new Outbox({ items: ob.items ?? [], seq: ob.seq ?? 0 });
  const msgs = (game.messages?.contents ?? []).map(m => ({ id: m.id, timestamp: m.timestamp, doc: m }));
  S.outbox.purgeDead(Date.now());
  for (const m of missedMessages(msgs, S.dedupe, Date.now())) handleChat(m.doc);
  if (S.outbox.items.length) S.batcher?.at(S.outbox.nextDueAt());
}

let persistTimer = null;
async function persistNow() {
  if (!amLeader()) return; clearTimeout(persistTimer);
  await Promise.all([game.settings.set(ID, "dedupeState", { entries: S.dedupe.toJSON() }), game.settings.set(ID, "outboxState", S.outbox.toJSON())]);
}
function persistSoon() {
  if (!amLeader()) return; clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { game.settings.set(ID, "dedupeState", { entries: S.dedupe.toJSON() }); game.settings.set(ID, "outboxState", S.outbox.toJSON()); }, 2000);
}

function onSocket(data) {
  if (!enabled() || !data?.type) return;
  if (data.type === "heartbeat") { S.leader = applyHeartbeat(S.leader, data, Date.now()); return; }
  if (data.type === "turnPing") return F.onTurnPing(data);
  if (data.type === "bubble") return F.showBubble(data);
  if (data.type === "voice") { thinking.hide(); return void onVoiceSocket(data); } // #12: players play bot voice locally
  if (data.type === "thinking") { if (data.on) thinking.show(data.timeoutMs); else thinking.hide(); return; } // #14
  if (data.type === "ack" && amLeader() && Array.isArray(data.eventIds)) game.modules.get(ID).api.ack(data.eventIds);
}

Hooks.on("createChatMessage", async (msg) => {
  if (enabled() && isBot(msg.author ?? msg.user ?? {})) thinking.hide(); // #14: bot spoke (runs on every client)
  if (!enabled() || !amLeader()) return;
  if (msg.flags?.[ID]?.local) return; // our own cards/replies never wake the bot
  if (isOwnShipCard(msg)) return; // v0.8 morale/ship cards we posted
  if ((msg.rolls?.length || msg.flags?.pirateborg?.outcomes?.length) && await F.onRollMessage(msg).catch(e => (log("rollRequest", e?.message), false))) return;
  handleChat(msg);
});
Hooks.on("renderChatMessageHTML", (msg, html) => { if (enabled()) F.bindRollCard(msg, html); });
Hooks.on("updateActor", (a, change) => { if (enabled() && amLeader()) F.onActorUpdate(a, change); });
Hooks.on("createActor", (a) => { if (enabled() && amLeader()) F.onActorUpdate(a, {}); });
Hooks.on("createItem", (i) => { if (enabled() && amLeader()) F.onItemCreate(i); });
Hooks.on("deleteCombat", (c) => { if (enabled() && amLeader()) F.onCombatDelete(c); });
function filterOpts(botId) {
  return { botUserId: botId, gmNames: list("botNames").map(n => n.toLowerCase()), keywords: list("keywords"), wakeOn: list("wakeOn"), ignoreOOC: get("ignoreOOC"),
    ignorePlainRolls: get("ignorePlainRolls"), ignoreUsers: list("ignoreUsers"), minChars: get("minChars") };
}
function handleChat(msg) {
  const eventId = `chat:${msg.id}`; const now = Date.now();
  const botId = get("botUserId") || game.users.find(u => isBot(u))?.id;
  const author = msg.author ?? msg.user; const authorId = author?.id;
  const plain = String(msg.content ?? "").replace(/<[^>]+>/g, "");
  S.metrics.inc("seen");
  if (get("unpauseOnStart") && /^\s*start\s*$/i.test(plain) && game.paused) game.togglePause(false, { broadcast: true });
  if (authorId !== botId && get("localCommands") && tryLocal(msg, plain, author)) return;
  const ev = { eventId, type: "chat", authorId, author: author?.name,
    speaker: msg.speaker?.alias ?? null, whisper: msg.whisper ?? [], text: msg.content ?? "",
    rolls: (msg.rolls ?? []).map(r => ({ formula: r.formula, total: r.total })),
    whisperToBot: (msg.whisper ?? []).includes(botId), inCharacter: !!msg.speaker?.actor,
    alwaysVoice: list("alwaysVoiceUsers").includes(author?.name) };
  const c = classify({ ...ev, text: plain }, filterOpts(botId));
  if (!c.wake) return S.metrics.filtered(c.reason);
  if (!S.dedupe.claim(eventId, now)) return;
  const { authorId: _a, whisperToBot: _w, inCharacter, ...lean } = ev; // compact: names only, drop flags the bot doesn't need
  S.outbox.enqueue({ ...lean, ic: inCharacter || undefined, why: c.reason }, now); S.dedupe.mark(eventId, "sent", now); persistNow();
  S.metrics.inc("woke"); S.batcher.push({ urgent: c.urgent, at: now });
}

// "!hp Bart -2" etc. Runs in Foundry, no bot wake. Players may change only actors they own; music/scene need a GM.
function tryLocal(msg, plain, author) {
  const cmd = parseLocal(plain, get("localPrefix") || "!"); if (!cmd) return false;
  const eventId = `local:${msg.id}`; if (!S.dedupe.claim(eventId, Date.now())) return true;
  const gmOnly = cmd.name === "music" || cmd.name === "scene";
  if (cmd.name === "turnStatus") { ChatMessage.create({ content: turnText(F.turnStatus()), whisper: [author.id], speaker: { alias: "AI GM" }, flags: { [ID]: { local: true } } }); S.dedupe.mark(eventId, "acked", Date.now()); return true; }
  const actor = cmd.args.actorName ? game.actors.getName(cmd.args.actorName) : null;
  const allowed = author?.isGM || (!gmOnly && (cmd.name === "roll" || actor?.testUserPermission?.(author, "OWNER")));
  const reply = (text) => ChatMessage.create({ content: text, whisper: [author.id], speaker: { alias: "AI GM" }, flags: { [ID]: { local: true } } });
  (async () => {
    if (!allowed) { await reply(`Not allowed: ${cmd.name}`); return S.dedupe.mark(eventId, "failed", Date.now()); }
    const r = await runCommand(cmd, ctxFor());
    S.dedupe.mark(eventId, r.ok ? "acked" : "failed", Date.now()); persistSoon(); S.metrics.inc("local");
    if (cmd.name === "setResource") await reply(r.ok ? `${actor?.name ?? cmd.args.actorName}: ${r.result.resource} ${r.result.before} → ${r.result.after}` : `!${cmd.args.resource}: ${r.error}`);
    else if (cmd.name === "rest") { if (!r.ok) await reply(`!rest: ${r.error}`); } // success posts its own card
    else if (cmd.name === "getShip" && r.ok) { const x = r.result; await reply(`${x.name}: HP ${x.hp.value}/${x.hp.max}, hull ${x.armorDie}, crew ${x.crew.value}/${x.crew.max}, shanties ${x.shanties.value}/${x.shanties.max}${x.sinking ? ", sinking" : ""}`); }
    else if (!r.ok) await reply(`${cmd.name}: ${r.error}`);
  })().catch(e => log("local command failed", e?.message));
  return true;
}

// v0.4 token lock: runs on the editing client, independent of leader/enabled so a lock always holds.
Hooks.on("preUpdateToken", (doc, change, _o, userId) => {
  const lock = doc.flags?.[ID]?.lock; if (!lock) return;
  const u = game.users.get(userId) ?? game.user;
  if (lockBlocks(lock, change, u?.isGM)) { if (userId === game.user.id) ui.notifications?.warn("That token is locked by the AI GM."); return false; }
});
// Deleted chat message: drop its queued event so the bot never sees it.
Hooks.on("deleteChatMessage", (msg) => {
  if (!enabled() || !amLeader() || !S.outbox) return;
  if (S.outbox.dropWhere(e => e.eventId === `chat:${msg.id}`).length) { S.metrics.inc("dropDeleted"); persistNow(); }
});
Hooks.on("updateCombat", (c, change) => {
  if (!enabled() || !amLeader() || !("turn" in change || "round" in change)) return;
  F.onCombatUpdate(c, change);
  if (get("turnPrompts")) F.turnPrompt(c).catch(e => log("turnPrompt", e?.message));
  if (!get("turnWake")) return; // v0.6: turns are handled locally; set turnWake to also wake the bot
  const eventId = `combat:${c.id}:${c.round}.${c.turn}`; const now = Date.now();
  if (!S.dedupe.claim(eventId, now)) return;
  S.outbox.enqueue({ eventId, type: "turn", combat: { id: c.id, round: c.round, turn: c.turn }, combatant: c.combatant?.name ?? null,
    isNPC: c.combatant?.actor ? !c.combatant.actor.hasPlayerOwner : null }, now);
  S.dedupe.mark(eventId, "sent", now); persistNow(); S.batcher?.push();
});

function liveCtx() {
  const c = game.combat;
  return { scene: canvas?.scene?.name ?? null, paused: game.paused,
    combat: c?.started ? { id: c.id, round: c.round, turn: c.turn, who: c.combatant?.name ?? null } : null };
}
function flush(opts = {}) {
  if (!amLeader() || !S.outbox) return;
  const now = Date.now();
  const gone = S.outbox.dropWhere(e => e.type === "chat" && String(e.eventId).startsWith("chat:") && !game.messages.get(e.eventId.slice(5)));
  if (gone.length) { S.metrics.inc("dropDeleted", gone.length); persistNow(); }
  const batch = S.outbox.nextBatch(now, game.world.id, { retriesOnly: !!(opts.retry && opts.burstOpen) });
  if (batch) {
    const ctx = liveCtx();
    const hints = get("ttsMinChars") > 0 ? { ttsMinChars: get("ttsMinChars") } : undefined;
    const payload = buildPayload(batch, { ctx, prevCtx: S.ackedCtx, maxChars: get("maxTextChars"), hints });
    if (batch.attempt === 1) {
      const firsts = S.outbox.items.filter(i => i.batchId === batch.batchId).map(i => i.firstAt);
      S.metrics.time("queue", now - Math.min(...firsts)); S.metrics.c.holdMaxMs = Math.max(S.metrics.c.holdMaxMs ?? 0, now - Math.min(...firsts));
      S.sent.set(batch.batchId, { at: now, ctx, ids: batch.events.map(e => e.eventId) });
      while (S.sent.size > 50) S.sent.delete(S.sent.keys().next().value);
    } else S.metrics.inc("retries");
    S.metrics.inc("batches"); S.metrics.inc("bytes", JSON.stringify(payload).length);
    S.lastBatch = payload;
    game.socket.emit(SOCKET, { type: "events", batch: payload }); // relay (headless/bot client) consumes this
    Hooks.callAll(`${ID}.events`, payload);
    if (shouldShowThinking(batch.events, batch.attempt)) thinkingOn(); // #14
    if (get("delivery") === "direct" && isBot() && get("webhookUrl")) {
      const api = game.modules.get(ID).api;
      deliverDirect(payload, { url: get("webhookUrl"), secret: get("webhookSecret"), header: get("webhookAuthHeader") || "Authorization",
        runCommand: (c) => api.run(c), ack: (ids) => api.ack(ids) })
        .then(r => { if (!r.ok) log(`direct delivery ${payload.batchId} failed`, r.status ?? r.error); }); // unacked → retried with backoff
    }
    const every = get("metricsLogEvery");
    log(`batch ${payload.batchId} events=${payload.events.length} bytes=${JSON.stringify(payload).length}${batch.attempt > 1 ? ` retry=${batch.attempt}` : ""}`);
    if (every > 0 && S.metrics.c.batches % every === 0) log("metrics", S.metrics.line());
  }
  const left = S.outbox.items.filter(i => i.attempts === 0 && !S.outbox.isDead(i));
  if (left.length) S.batcher?.push({ at: Math.min(...left.map(i => i.firstAt)) }); // e.g. >batchMax or held back by a retry wake: keep their cap
  S.batcher?.at(S.outbox.nextDueAt()); // next retry, if any — no polling
}
