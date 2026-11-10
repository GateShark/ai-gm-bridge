// AI GM Pirate Borg — entry point (module id ai-gm-bridge; version comes from module.json) (bot-agnostic). Does nothing unless world setting `enabled` is true.
import { decideLeader, applyHeartbeat } from "./lib/leader.mjs";
import { DedupeStore } from "./lib/dedupe.mjs";
import { Outbox, relayAutoAckIds, relayStaleChatIds } from "./lib/outbox.mjs";
import { classify } from "./lib/filter.mjs";
import { Batcher } from "./lib/batcher.mjs";
import { parseLocal } from "./lib/local.mjs";
import { isOwn as isOwnShipCard } from "./lib/ship.mjs";
import { buildPayload } from "./lib/compact.mjs";
import { VoiceCache } from "./lib/voicecache.mjs";
import { TurnClipStore, resolveTurnClip, turnClipAudioMap } from "./lib/turnclips.mjs";
import { ttsVoiceSlug, playVoicePreview } from "./lib/voices.mjs";
import { applyMood, parseMoodPlaylists, moodState, rememberMood, restoreMoodKey } from "./lib/mood.mjs";
import { Metrics } from "./lib/metrics.mjs";
import { deliverDirect } from "./lib/direct.mjs";
import { makeConfigApp } from "./config-app.mjs";
import { fail } from "./lib/result.mjs";
import {
  callerConnectionError, withTimeout, commandTimeoutMs, COMMAND_TIMEOUT_ERROR,
  runLinkProbe, resolveOfflineAfterMs, isLinkFresh, findBotUser, publicPresence,
  shouldProbeLink, presenceFreshOpts, isPresenceSuspended, shouldForceResumeProbe, PING_TIMEOUT_MS
} from "./lib/presence.mjs";
import { runCommand, COMMANDS, onVoiceSocket, audioQueue } from "./commands.mjs";
import { missedMessages } from "./lib/replies.mjs";
import { lockBlocks } from "./lib/spawn.mjs";
import { burstTest } from "./lib/bursttest.mjs";
import { formatResult, sceneBackgroundSrc } from "./lib/v081.mjs";
import { installAudioResume, showAudioUnlockPrompt } from "./lib/audioqueue.mjs";
import * as F from "./features.mjs";
import { getContext } from "./context.mjs";
import { cleanupContextJournals } from "./gmstore.mjs";
import { turnText, shouldWakeOnTurn, combatantIsNpc } from "./lib/turns.mjs";
import { combatEvent, startedNow } from "./lib/combatevents.mjs";
import { liveSetupCheck } from "./lib/setupcheck.mjs";
import { rollBreakdown } from "./lib/rollreq.mjs";
import { ThinkingIndicator, shouldShowThinking } from "./lib/thinking.mjs";
import { PushToTalk, speechLang } from "./lib/ptt.mjs";
import { GmStatusPill, deriveGmStatus, normalizeGmStatus } from "./lib/gmstatus.mjs";
import { makeGmPanel, collectHp, sceneTokens, installSidebarButton, makeControlEvent, resolveWakeEventIds, newestChatEventIds, formatClearedStuck, PANEL_LOGO_SRC } from "./lib/gmpanel.mjs";
import { DEFAULT_HP_PATH, LEGACY_HP_PATH } from "./lib/hp.mjs";
import { listTables } from "./lib/quickgm.mjs";
import { formatSessionRecap } from "./lib/session.mjs";
import { crewTracker } from "./lib/shiptrack.mjs";
import { enhanceVoiceMessage } from "./lib/voiceui.mjs";
import { injectStyles } from "./lib/styles.mjs";

const ID = "ai-gm-bridge"; const SOCKET = `module.${ID}`;
const S = { leader: null, dedupe: null, outbox: null, timers: [], lastBatch: null, batcher: null, voice: null, metrics: new Metrics(), ackedCtx: null, sent: new Map() };
const list = (k) => String(get(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
const get = (k) => game.settings.get(ID, k);
const enabled = () => !!get("enabled");
const isBot = (u = game.user) => u.id === get("botUserId") || (!get("botUserId") && !!get("botUserName") && u.name?.toLowerCase().startsWith(get("botUserName").toLowerCase()));
const amLeader = () => S.leader?.leaderId === game.user.id;
// #14: one pill per client; label is localized when shown.
const thinking = new ThinkingIndicator({ label: () => game.i18n?.localize?.("AIGM.thinking") || "GM is thinking…", silent: true, onChange: () => refreshStatus() });
let statusPill = null, settingsLive = false, panelApp = null;
function loc(k, f) { const v = game.i18n?.localize?.(k); return v && v !== k ? v : (f || k); }
function readPresenceFromGame(now = Date.now()) {
  let probe = null;
  try { probe = game.settings.get(ID, "linkProbe"); } catch {}
  let botUserId = "", botUserName = "";
  try { botUserId = get("botUserId"); botUserName = get("botUserName"); } catch {}
  const bot = findBotUser(game.users, { botUserId, botUserName }) || game.users?.find?.(u => isBot(u));
  return publicPresence({
    now, worldId: game.world?.id ?? null, botUser: bot, probe,
    botUserId: bot?.id || botUserId, lastConfirmed: S.lastConfirmed
  });
}
function readSuspendUntil() {
  try { return Number(get("presenceSuspendUntil")) || 0; } catch { return 0; }
}
function linkState(now = Date.now()) {
  const p = readPresenceFromGame(now);
  let offlineAfterMs = 60000;
  try { offlineAfterMs = resolveOfflineAfterMs(get("offlineAfterMs")); } catch {}
  const selfIsBot = isBot();
  const suspendUntil = readSuspendUntil();
  const display = presenceFreshOpts({
    botActive: p.botActive, lastSeen: p.lastSeen || 0, now, offlineAfterMs, selfIsBot, suspendUntil
  });
  return {
    ...p, selfIsBot, offlineAfterMs, suspendUntil, display,
    fresh: isLinkFresh(display)
  };
}
function pillState(link) {
  return deriveGmStatus({
    thinking: thinking.visible && (thinking.kind === "thinking" || !thinking.kind),
    activity: thinking.visible ? thinking.kind : null,
    sendingVoice: thinking.visible && thinking.kind === "voicing",
    paused: !!get("aiPaused"), enabled: enabled(),
    botActive: link.display.botActive, lastConfirmed: link.display.lastConfirmed, now: link.display.now,
    offlineAfterMs: link.display.offlineAfterMs, selfIsBot: link.display.selfIsBot
  });
}
function refreshStatus() {
  if (!statusPill) return;
  try {
    const now = Date.now();
    const link = linkState(now);
    statusPill.set(pillState(link), { lastReplyAt: S.lastReplyAt, lastSeen: link.lastSeen, now, since: thinking.visible ? thinking.since : null, note: thinking.visible ? thinking.note : null });
  } catch {}
}
let presenceResumeTimer = null;
function clearPresenceResumeTimer() {
  if (presenceResumeTimer != null) { clearTimeout(presenceResumeTimer); presenceResumeTimer = null; }
}
function forceResumePresence(now = Date.now()) {
  S.presenceWasSuspended = false;
  S.nextProbeAt = 0;
  maybeProbeLink(now);
  refreshStatus();
  refreshPanel();
}
function armPresenceResumeTimer(until = readSuspendUntil(), now = Date.now()) {
  clearPresenceResumeTimer();
  if (!isPresenceSuspended(until, now)) return;
  S.presenceWasSuspended = true;
  presenceResumeTimer = setTimeout(() => {
    presenceResumeTimer = null;
    forceResumePresence(Date.now());
  }, Math.max(0, Number(until) - now) + 25);
}
function onPresenceSuspendSetting() {
  const until = readSuspendUntil();
  const now = Date.now();
  if (isPresenceSuspended(until, now)) {
    armPresenceResumeTimer(until, now);
    refreshStatus();
    refreshPanel();
    return;
  }
  clearPresenceResumeTimer();
  forceResumePresence(now);
}
function maybeProbeLink(now = Date.now()) {
  let every = 30000;
  try { every = Math.max(15000, Math.floor(resolveOfflineAfterMs(get("offlineAfterMs")) / 2)); } catch {}
  const until = readSuspendUntil();
  const suspended = isPresenceSuspended(until, now);
  if (suspended) {
    S.presenceWasSuspended = true;
    return;
  }
  if (shouldForceResumeProbe({ suspended, wasSuspended: !!S.presenceWasSuspended })) {
    S.presenceWasSuspended = false;
    S.nextProbeAt = 0;
  }
  if (!shouldProbeLink({ enabled: enabled(), isBot: isBot(), now, nextProbeAt: S.nextProbeAt, suspendUntil: until })) return;
  S.nextProbeAt = now + every;
  runLinkProbe({
    now, userId: game.user?.id ?? "", isBotWriter: true, timeoutMs: PING_TIMEOUT_MS,
    setSetting: (v) => game.settings.set(ID, "linkProbe", v),
    getSetting: () => game.settings.get(ID, "linkProbe")
  }).then((r) => {
    if (r.ok) S.lastConfirmed = Number(r.data?.lastBotAt) || r.at || now;
    refreshStatus();
    refreshPanel();
  }).catch(() => { refreshStatus(); });
}
function thinkingOn({ kind = "thinking", note = null, timeoutMs, broadcast = true } = {}) { if (!get("thinkingIndicator")) return; const ms = timeoutMs ?? get("thinkingTimeoutMs"); thinking.show(ms, { kind, note }); refreshStatus(); if (broadcast) game.socket.emit(SOCKET, { type: "thinking", on: true, timeoutMs: ms, kind, note: note || undefined }); }
function thinkingOff({ broadcast = false } = {}) { thinking.hide(); refreshStatus(); if (broadcast) game.socket.emit(SOCKET, { type: "thinking", on: false, lastReplyAt: S.lastReplyAt ?? undefined }); }
function onAiPausedChange(paused) {
  if (!settingsLive) return;
  thinkingOff({ broadcast: true });
  refreshStatus();
  if (S.skipAiPauseEmit) return;
  if (amLeader()) emitControl(paused ? "pause" : "resume");
}
async function doStart() {
  thinkingOff({ broadcast: true });
  if (game.paused) game.togglePause(false, { broadcast: true });
  if (!amLeader()) {
    try { game.socket.emit(SOCKET, { type: "sessionControl", action: "start" }); } catch {}
    refreshStatus(); refreshPanel();
    return { ok: true, result: { paused: false, aiPaused: false, control: "start", forwarded: true } };
  }
  S.skipAiPauseEmit = true;
  try { await game.settings.set(ID, "aiPaused", false); } catch {}
  S.skipAiPauseEmit = false;
  refreshStatus(); refreshPanel();
  if (enabled()) { emitControl("start", { foundryPaused: !!game.paused }); flush(); }
  return { ok: true, result: { paused: !!game.paused, aiPaused: false, control: "start" } };
}
async function doPause() {
  thinkingOff({ broadcast: true });
  if (!amLeader()) {
    try { game.socket.emit(SOCKET, { type: "sessionControl", action: "pause" }); } catch {}
    if (!game.paused) game.togglePause(true, { broadcast: true });
    refreshStatus(); refreshPanel();
    return { ok: true, result: { paused: true, aiPaused: true, control: "pause", forwarded: true } };
  }
  S.skipAiPauseEmit = true;
  try { await game.settings.set(ID, "aiPaused", true); } catch {}
  S.skipAiPauseEmit = false;
  if (!game.paused) game.togglePause(true, { broadcast: true });
  refreshStatus(); refreshPanel();
  if (enabled()) { emitControl("pause", { foundryPaused: !!game.paused }); flush(); }
  return { ok: true, result: { paused: true, aiPaused: true, control: "pause" } };
}
function emitControl(action, extra = {}) { return emitEvent(makeControlEvent(action, extra), { urgent: true, evenIfPaused: true }); }
function wakeTargetIds(data) {
  return resolveWakeEventIds(S.lastWake, data?.targetEventIds, () => newestChatEventIds(game.messages?.contents ?? [], {
    limit: 5, skip: (m) => !!(m.flags?.[ID]?.local) || isBot(m.author ?? m.user ?? {}) || isOwnShipCard(m)
  }));
}
function handleGmControl(data) {
  if (!data?.action) return;
  if (data.action === "redo") { const ids = wakeTargetIds(data); emitControl("redo", { targetEventIds: ids, replyTo: ids[0] ?? null }); thinkingOn(); }
  else if (data.action === "skip") { thinkingOff({ broadcast: true }); emitControl("skip", { targetEventIds: wakeTargetIds(data) }); }
  else if (data.action === "cancelRoll" && data.requestId) F.cancelRollRequest(data.requestId);
  else if (data.action === "clearStuck") doClearStuck();
}
function clearLocalOutbox() {
  const ids = (S.outbox?.items ?? []).map(i => i.event.eventId);
  const n = S.outbox?.ack(ids) ?? 0;
  for (const id of ids) S.dedupe?.mark(id, "acked", Date.now());
  return n;
}
function doClearStuck() {
  thinkingOff({ broadcast: true });
  const n = clearLocalOutbox();
  persistNow();
  refreshPanel();
  try { game.socket.emit(SOCKET, { type: "stuckCleared", count: n }); } catch {}
  return { ok: true, result: { cleared: n } };
}
function refreshPanel() { try { if (panelApp?.rendered) panelApp.render(); } catch {} }
async function panelAction(action, data = {}) {
  if (action === "pause") return game.settings.set(ID, "aiPaused", true);
  if (action === "resume") return game.settings.set(ID, "aiPaused", false);
  if (action === "redo" || action === "skip" || action === "cancelRoll") {
    if (amLeader()) handleGmControl({ action, ...data });
    else game.socket.emit(SOCKET, { type: "gmControl", action, ...data });
    return;
  }
  if (action === "recap") return F.recap({ max: 40 });
  if (action === "clearStuck") {
    if (amLeader()) {
      const r = doClearStuck();
      ui.notifications?.info?.(formatClearedStuck(r.result.cleared, loc));
      return r;
    }
    game.socket.emit(SOCKET, { type: "gmControl", action: "clearStuck" });
    clearLocalOutbox();
    refreshPanel();
    return;
  }
  if (action === "setupCheck") {
    const setup = liveSetupCheck({ scene: globalThis.canvas?.scene ?? game.scenes?.viewed, combat: game.combat, users: game.users?.contents ?? [] });
    const msg = setup.warning || setup.text;
    if (setup.warning) ui.notifications?.warn?.(msg); else ui.notifications?.info?.(msg);
    return setup;
  }
  if (action === "startGame") return doStart();
  if (action === "pauseGame") return doPause();
  const runPanel = async (name, args, okMsg) => {
    const r = await runCommand({ name, args }, ctxFor());
    if (!r.ok) ui.notifications?.warn?.(r.error || name);
    else if (okMsg) ui.notifications?.info?.(typeof okMsg === "function" ? okMsg(r.result) : okMsg);
    refreshPanel();
    return r.ok ? r.result : r;
  };
  if (action === "saveSession") return runPanel("saveSession", { notes: data.notes ?? "" }, (x) => x.recap || "Session saved");
  if (action === "loadSession") return runPanel("loadSession", { placePets: true }, null);
  if (action === "rollTable") return runPanel("rollTable", { tableId: data.tableId }, (x) => x.text ? `${x.table}: ${x.text}` : (x.table || "Rolled"));
  if (action === "giveLoot") return runPanel("giveLoot", { tableId: data.tableId }, (x) => `${x.name}: ${(x.added || []).join(", ") || (x.texts || []).join("; ") || "no item"}`);
  if (action === "applyDamage") return runPanel("applyDamage", { amount: Number(data.damage) }, (x) => `Applied ${x.amount} damage`);
  if (action === "startShipCombat") return runPanel("startShipCombat", {}, (x) => `Ship fight: ${(x.ships || []).map(s => s.name).join(", ")}`);
}
const log = (...a) => console.log(`${ID} |`, ...a);

let pttInst = null;
function setupPtt() {
  pttInst?.uninstall(); pttInst = null;
  const keyOn = !!game.settings.get(ID, "pushToTalk");
  let position = null, speechHints = "", speechFixes = "";
  try { position = game.settings.get(ID, "pttPosition"); } catch {}
  try { speechHints = get("speechHints") || ""; speechFixes = get("speechFixes") || ""; } catch {}
  pttInst = new PushToTalk({ win: window, doc: document, t: (k) => game.i18n.localize(k), lang: speechLang(game.i18n.lang, navigator.language), key: game.settings.get(ID, "pushToTalkKey"),
    notify: (m) => ui.notifications?.info(m),
    onceNotice: () => { if (game.settings.get(ID, "pushToTalkNoticeShown")) return false; game.settings.set(ID, "pushToTalkNoticeShown", true); return true; },
    post: (text) => ChatMessage.create({ content: text, speaker: ChatMessage.getSpeaker() }),
    position, onMove: (pos) => { try { game.settings.set(ID, "pttPosition", pos); } catch {} },
    logoSrc: PANEL_LOGO_SRC, speechHints, speechFixes });
  pttInst.install({ keyboard: keyOn, notifyIfMissing: keyOn });
}

function onTtsVoiceChange(raw, play) {
  const slug = ttsVoiceSlug(raw);
  try { game.user?.setFlag?.(ID, "gmVoice", slug); } catch {}
  if (play) playVoicePreview(raw);
}
function syncGmVoiceFlag() {
  let raw = "en-GB-RyanNeural";
  try { raw = game.settings.get(ID, "ttsVoice") || raw; } catch {}
  onTtsVoiceChange(raw, false);
}

Hooks.once("init", () => {
  // 0.8.7: pre-ready stub so macros/scripts that run early can wait instead of throwing.
  { const mod = game.modules?.get?.(ID); let res; const p = new Promise(r => (res = r)); globalThis.__aigmReady = res;
    if (mod) mod.api = { version: mod.version, ready: false, whenReady: () => p }; }
  const reg = (k, type, def, extra = {}) => game.settings.register(ID, k, { scope: "world", config: false, restricted: true, type, default: def,
    name: `AIGM.settings.${k}.name`, hint: `AIGM.settings.${k}.hint`, ...extra });
  reg("enabled", Boolean, false, { onChange: () => restart() });
  reg("botUserId", String, "", { config: false }); reg("botUserName", String, "");
  reg("botNames", String, "gm, ai gm", { config: false });
  reg("delivery", String, "relay", { config: false, choices: { relay: "relay", direct: "direct" } });
  reg("webhookUrl", String, "", { config: false }); reg("webhookAuthHeader", String, "Authorization", { config: false });
  game.settings.register(ID, "webhookSecret", { scope: "world", config: false, restricted: true, type: String, default: "" });
  game.settings.registerMenu(ID, "config", { name: "AI GM Pirate Borg", label: "Configure AI GM Pirate Borg", icon: "fas fa-robot", type: makeConfigApp(), restricted: true });
  reg("heartbeatMs", Number, 10000); reg("heartbeatTimeoutMs", Number, 45000); reg("offlineAfterMs", Number, 60000); reg("batchMs", Number, 3500);
  reg("keywords", String, ""); reg("hpPath", String, "system.attributes.hp.value");
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
  reg("turnPrompts", Boolean, true); reg("turnWake", Boolean, true); // v0.8.11: default on; stored off is left off (see resolveTurnWake). NPC-only filter is in updateCombat.
  reg("turnVoiceUsers", String, "");
  reg("voiceTurnPrompt", Boolean, true);
  reg("speechHints", String, "kick, dropkick, drop kick, slash, parry, dodge, block, strike, thrust, shoot, steal, sneak, hide, attack, defend, broken, agility, strength, presence, toughness, spirit");
  reg("speechFixes", String, "drop cake=dropkick, drop cakes=dropkick, kik=kick, perry=parry, pulled up behind=ducked behind");
  reg("sessionLog", Boolean, true);
  // v0.8 house rule: pirateborg v1.9.0 ram ignores the target armour roll; on = subtract it
  reg("ramUsesArmor", Boolean, false);
  // v0.8.2 #14 "GM is thinking…" indicator
  // v0.8.3 immediate combat start/end events (turnWake = also send each turn/round change)
  reg("combatEvents", Boolean, true);
  // v0.8.5 push-to-talk: per-browser (client scope), off by default; every player enables it for themselves.
  const ptt = () => setupPtt();
  game.settings.register(ID, "pushToTalk", { scope: "client", config: true, type: Boolean, default: false, name: "AIGM.settings.pushToTalk.name", hint: "AIGM.settings.pushToTalk.hint", onChange: ptt });
  game.settings.register(ID, "pushToTalkKey", { scope: "client", config: true, type: String, default: "Backquote", name: "AIGM.settings.pushToTalkKey.name", hint: "AIGM.settings.pushToTalkKey.hint", onChange: ptt });
  game.settings.register(ID, "pushToTalkNoticeShown", { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(ID, "pttPosition", { scope: "client", config: false, type: Object, default: { x: null, y: null } });
  // Per-player spoken voice (client, not world). Mirrored to flags[ai-gm-bridge].gmVoice so the GM can read everyone's pick.
  game.settings.register(ID, "ttsVoice", { scope: "client", config: true, type: String, default: "en-GB-RyanNeural",
    name: "AIGM.settings.ttsVoice.name", hint: "AIGM.settings.ttsVoice.hint",
    choices: { "en-GB-RyanNeural": "Ryan (British man)", "en-GB-ThomasNeural": "Thomas (British man)", "en-GB-SoniaNeural": "Sonia (British woman)", "en-US-AriaNeural": "Aria (American woman)" },
    onChange: (v) => { try { onTtsVoiceChange(v, true); } catch {} } });
  game.settings.register(ID, "voiceVolume", { scope: "client", config: true, type: Number, default: 80,
    name: "AIGM.settings.voiceVolume.name", hint: "AIGM.settings.voiceVolume.hint" });
  game.settings.register(ID, "voiceCaptions", { scope: "client", config: true, type: Boolean, default: false,
    name: "AIGM.settings.voiceCaptions.name", hint: "AIGM.settings.voiceCaptions.hint" });
  reg("moodPlaylists", String, "");
  reg("moodFollowsCombat", Boolean, true);
  reg("moralePrompts", Boolean, true);
  reg("thinkingIndicator", Boolean, true); reg("thinkingTimeoutMs", Number, 90000);
  reg("aiPaused", Boolean, false, { config: false, onChange: (v) => { try { onAiPausedChange(v); } catch {} } });
  // v0.7 (GM-only: world setting, config menu is GM-only)
  // v0.7.0 stored the context journal list here. Kept hidden (config:false) only so v0.7.2 can clear it; never written otherwise.
  game.settings.register(ID, "contextJournals", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(ID, "voiceCache", { scope: "world", config: false, type: Object, default: { entries: [] } });
  game.settings.register(ID, "turnClips", { scope: "world", config: false, type: Object, default: { entries: [] } });
  game.settings.register(ID, "dedupeState", { scope: "world", config: false, type: Object, default: { entries: [] } });
  game.settings.register(ID, "outboxState", { scope: "world", config: false, type: Object, default: { items: [], seq: 0 } });
  game.settings.register(ID, "linkProbe", { scope: "world", config: false, type: Object, default: { nonce: "", at: 0, by: "", lastBotAt: 0 } });
  game.settings.register(ID, "sessionSnapshot", { scope: "world", config: false, type: Object, default: { savedAt: 0, scene: null, combat: null, actors: [], notes: "" } });
  game.settings.register(ID, "presenceSuspendUntil", { scope: "world", config: false, type: Number, default: 0 });
});

Hooks.once("ready", () => {
  try { setupPtt(); } catch (e) { console.warn(`${ID} | push-to-talk`, e); }
  try { syncGmVoiceFlag(); } catch {} 
  try { injectStyles(); } catch {}
  try { statusPill = new GmStatusPill({ t: loc, onClick: (tip) => ui.notifications?.info?.(tip) }); statusPill.mount(); } catch {}
  const mod = game.modules.get(ID);
  const whenReady = mod.api?.whenReady ?? (() => Promise.resolve(mod.api));
  try { installAudioResume({ queue: audioQueue, beforeUnlock: async () => { await game.audio?.unlock; try { await game.audio?.context?.resume?.(); } catch {} } }); } catch {}
  try { if (game.audio?.locked) showAudioUnlockPrompt({ queue: audioQueue, label: loc("AIGM.audio.enableSound", "Enable sound"), beforeUnlock: async () => { await game.audio?.unlock; try { await game.audio?.context?.resume?.(); } catch {} } }); } catch {}
  try { if (game.user?.isGM && get("hpPath") === LEGACY_HP_PATH) game.settings.set(ID, "hpPath", DEFAULT_HP_PATH); } catch {}
  mod.api = {
    version: mod.version, ready: true, whenReady, commands: Object.keys(COMMANDS),
    status: () => ({ enabled: enabled(), leader: S.leader, amLeader: amLeader(), queued: S.outbox?.items.length ?? 0, dead: S.outbox?.dead().length ?? 0,
      deadIds: S.outbox?.dead().map(i => i.event.eventId) ?? [], ...readPresenceFromGame() }),
    metrics: () => S.metrics.snapshot(),
    format: (r) => formatResult(r),
    debug: { burstTest: (o = {}) => burstTest({ debounceMs: get("debounceMs"), maxWaitMs: get("maxWaitMs"), ...o }) },
    debugSuspendPresence: async (seconds) => {
      if (!game.user?.isGM) return fail(403, "GM only");
      return runCommand({ name: "debugSuspendPresence", args: { seconds: Number(seconds) } }, ctxFor());
    },
    clearDead: () => { thinkingOff({ broadcast: true }); const ids = S.outbox?.clearDead() ?? []; persistSoon(); return { ok: true, result: { cleared: ids } }; },
    clearStuck: () => {
      if (!amLeader()) {
        game.socket.emit(SOCKET, { type: "gmControl", action: "clearStuck" });
        const n = clearLocalOutbox();
        refreshPanel();
        return { ok: true, result: { cleared: n, forwarded: true } };
      }
      return doClearStuck();
    },
    run: async (cmd) => {
      if (!enabled()) return fail(503, "AI GM bridge disabled in this world");
      const connErr = callerConnectionError({ user: game.user, socket: game.socket, ready: game.ready });
      if (connErr) return fail(503, connErr);
      if (!game.user.isGM || !isBot()) return fail(403, "commands only accepted from the bot GM user");
      if (cmd?.name !== "ping" && !amLeader()) return fail(421, "not leader", { leader: S.leader?.leaderId ?? null });
      const work = async () => {
        if (cmd?.commandId) { if (!S.dedupe.claim(`cmd:${cmd.commandId}`, Date.now())) { const e = S.dedupe.get(`cmd:${cmd.commandId}`); const done = e?.s === "acked";
            return fail(409, done ? "already done" : "in progress", { alreadyDone: done, prior: e?.res ?? null }); } await persistNow(); }
        if (cmd?.name !== "ping") { // #14: any bot action ends the wait (ping is a health check)
          const n = cmd?.name;
          if (n === "setGmStatus") {
            const state = normalizeGmStatus(cmd?.args?.state);
            if (state === "listening") thinkingOff({ broadcast: true });
            else if (state) thinkingOn({ kind: state, note: cmd?.args?.note, timeoutMs: cmd?.args?.timeoutMs });
          } else if (n === "requestRoll") thinkingOn({ kind: "rolling" });
          else if (n === "postVoice" || n === "voiceLookup") thinkingOn({ kind: "voicing" });
          else if (n === "playAudio") thinkingOn({ kind: "speaking", broadcast: false });
          else { S.lastReplyAt = Date.now(); thinkingOff({ broadcast: true }); }
        }
        const res = await runCommand(cmd, ctxFor());
        const rt = cmd?.args?.replyTo && game.messages?.get(String(cmd.args.replyTo).replace(/^chat:/, ""))?.timestamp;
        if (res.ok && rt) S.metrics.time("reply", Date.now() - rt);
        if (cmd?.commandId) S.dedupe.mark(`cmd:${cmd.commandId}`, res.ok ? "acked" : "failed", Date.now(), { res }); persistSoon();
        return res;
      };
      try { return await withTimeout(work(), commandTimeoutMs(cmd), COMMAND_TIMEOUT_ERROR); }
      catch (e) { return fail(504, e?.message || COMMAND_TIMEOUT_ERROR); }
    },
    ping: async () => {
      if (!game.user?.isGM) return fail(403, "GM only");
      return runCommand({ name: "ping" }, ctxFor());
    },
    ack: (eventIds) => { thinkingOff({ broadcast: true }); onAcked(eventIds); const n = S.outbox?.ack(eventIds) ?? 0; S.metrics.inc("acked", n); for (const id of eventIds) S.dedupe?.mark(id, "acked", Date.now()); persistSoon(); return { ok: true, result: { acked: n } }; },
    // GM-only, returned to the caller only. Players get 403 and nothing is sent anywhere.
    context: (o = {}) => getContext(game, o),
    turnStatus: () => {
      const t = F.turnStatus();
      return { active: !!t, ...(t ?? {}), expect: t?.expect ?? null, ...readPresenceFromGame() };
    }, recap: (o) => F.recap(o),
    setupCheck: () => liveSetupCheck({ scene: globalThis.canvas?.scene ?? game.scenes?.viewed, combat: game.combat, users: game.users?.contents ?? [] }),
    startGame: () => doStart(), pauseGame: () => doPause(),
    saveSession: (o = {}) => runCommand({ name: "saveSession", args: o }, ctxFor()),
    loadSession: (o = {}) => runCommand({ name: "loadSession", args: o }, ctxFor()),
    takeBatch: () => S.lastBatch, // relay stub can poll this on the headless client
    paused: () => !!get("aiPaused"),
    gmStatus: () => {
      const link = linkState();
      return statusPill?.state ?? pillState(link);
    },
  };
  try { globalThis.__aigmReady?.(mod.api); } catch {}
  game.socket.on(SOCKET, onSocket);
  if (game.user.isGM && game.users.activeGM?.id === game.user.id) cleanupContextJournals(game).then(r => r.cleared && log("v0.7.2: the context journal list is no longer stored in the world (players could read it). Set AIGM_CONTEXT_JOURNALS on the relay or pass journals per getContext call. Old value:", r.old)).catch(e => log("migrate", e?.message));
  F.initFeatures({ get, amLeader, log, voice: (t, voice) => S.voice?.get(t, voice) ?? null, turnClip: (name, voice) => resolveTurnClip(name, voice, S.turnClips), turnAudio: (name) => turnClipAudioMap(name, S.turnClips), emit: emitEvent, dedupe: S.dedupe });
  try {
    audioQueue.onStart = () => thinkingOn({ kind: "speaking", broadcast: false });
    audioQueue.onIdle = () => { if (thinking.visible && thinking.kind === "speaking") thinkingOff({ broadcast: false }); };
  } catch {}
  restart();
  if (game.user.isGM) {
    try {
      const Panel = makeGmPanel({
        t: loc,
        gather: () => {
          const dead = S.outbox?.dead().length ?? 0;
          const queued = Math.max(0, (S.outbox?.items.length ?? 0) - dead);
          const scene = globalThis.canvas?.scene ?? game.scenes?.viewed;
          const tokens = sceneTokens(scene);
          const setup = liveSetupCheck({ scene, combat: game.combat, users: game.users?.contents ?? [], tokens });
          const now = Date.now();
          const link = linkState(now);
          const linkUi = {
            state: pillState(link),
            lastSeen: link.lastSeen, now, gmUserActive: link.gmUserActive,
            since: thinking.visible ? thinking.since : null
          };
          let snap = null; try { snap = get("sessionSnapshot"); } catch {}
          return { paused: !!get("aiPaused"), turn: F.turnStatus(), pending: F.pendingRequests(), hp: collectHp(tokens, { hpPath: get("hpPath") }), setup, stuck: { queued, dead }, link: linkUi,
            tables: listTables(game.tables), sessionNotes: snap?.notes || "", sessionRecap: snap?.savedAt ? formatSessionRecap(snap) : "" };
        },
        confirm: async (msg) => {
          try {
            const Dlg = foundry?.applications?.api?.DialogV2;
            if (Dlg?.confirm) {
              const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
              return !!(await Dlg.confirm({ window: { title: loc("AIGM.panel.clearStuck", "Clear stuck") }, content: `<p>${esc(msg)}</p>` }));
            }
          } catch {}
          return typeof globalThis.confirm === "function" ? globalThis.confirm(msg) : true;
        },
        onAction: panelAction
      });
      const openPanel = () => { panelApp ??= new Panel(); panelApp.render(true); };
      const install = () => installSidebarButton({ doc: document, label: loc("AIGM.panel.title", "AI GM Pirate Borg"), open: openPanel });
      install(); Hooks.on("renderSidebar", install);
    } catch (e) { log("gm panel", e?.message); }
  }
  settingsLive = true; refreshStatus();
  Hooks.on("userConnected", () => refreshStatus()); Hooks.on("userDisconnected", () => refreshStatus());
  Hooks.on("updateUser", () => { refreshStatus(); if (enabled()) refreshPanel(); });
  Hooks.on("updateSetting", (setting) => {
    const key = String(setting?.key ?? setting?.id ?? "");
    if (key === `${ID}.linkProbe` || key === "linkProbe" || key.endsWith(".linkProbe")) {
      refreshStatus(); refreshPanel();
    }
    if (key === `${ID}.presenceSuspendUntil` || key === "presenceSuspendUntil" || key.endsWith(".presenceSuspendUntil")) {
      onPresenceSuspendSetting();
    }
    if (key === `${ID}.outboxState` || key === "outboxState" || key.endsWith(".outboxState")) {
      if (!amLeader()) {
        try {
          const ob = get("outboxState") ?? {};
          S.outbox = new Outbox({ items: ob.items ?? [], seq: ob.seq ?? 0 });
        } catch {}
      }
      refreshPanel();
    }
  });
  try { setInterval(() => { try { refreshStatus(); if (panelApp?.rendered) refreshPanel(); } catch {} }, 15000); } catch {}
});

function ctxFor() {
  return { dedupe: S.dedupe, persistNow, ack: (ids) => game.modules.get(ID).api.ack(ids), voiceCache: S.voice, turnClips: S.turnClips, ttsMinChars: get("ttsMinChars"),
    metrics: S.metrics, lastWake: S.lastWake, persistVoice: () => { clearTimeout(S.vt); S.vt = setTimeout(() => game.settings.set(ID, "voiceCache", { entries: S.voice.toJSON() }), 3000); },
    persistTurnClips: () => { clearTimeout(S.ttc); S.ttc = setTimeout(() => game.settings.set(ID, "turnClips", { entries: S.turnClips.toJSON() }), 3000); } };
}
// Ack bookkeeping: ack latency per batch, and remember the ctx the bot has definitely seen (payload ctx is a diff against it).
function onAcked(eventIds) {
  const s = new Set(eventIds);
  for (const [bid, b] of S.sent) if (b.ids.every(id => s.has(id))) { S.metrics.time("ack", Date.now() - b.at); S.ackedCtx = b.ctx; S.sent.delete(bid); }
}
// Relay-mode chat ack: updates the outbox without thinkingOff (unlike api.ack). Official relay / live.js can still call api.ack; already-acked ids are a no-op.
function ackRelayChatIds(ids, { immediate = false } = {}) {
  if (!ids?.length || !S.outbox) return 0;
  onAcked(ids);
  const n = S.outbox.ack(ids);
  S.metrics.inc("acked", n);
  for (const id of ids) S.dedupe?.mark(id, "acked", Date.now());
  if (n && thinking.visible && thinking.kind === "waking") thinkingOn({ kind: "reading" });
  if (immediate) persistNow(); else persistSoon();
  return n;
}
function ackRelayStaleChat() {
  if (get("delivery") !== "relay" || !S.outbox) return 0;
  return ackRelayChatIds(relayStaleChatIds(S.outbox.items), { immediate: true });
}
function stop() { S.timers.forEach(clearInterval); S.timers = []; S.batcher?.stop(); }
function restart() {
  stop();
  if (!enabled() || !game.user.isGM) return log("idle (disabled or not GM)");
  S.dedupe = new DedupeStore({ entries: get("dedupeState")?.entries ?? [] });
  const ob = get("outboxState") ?? {}; S.outbox = new Outbox({ items: ob.items ?? [], seq: ob.seq ?? 0 });
  S.voice = new VoiceCache({ entries: get("voiceCache")?.entries ?? [] });
  S.turnClips = new TurnClipStore({ entries: get("turnClips")?.entries ?? [] });
  S.outbox.purgeDead(Date.now());
  ackRelayStaleChat();
  // Heartbeat is the only interval (leader liveness needs it). Flushes are event-driven: debounced chat bursts + retry wake-ups.
  S.timers.push(setInterval(tickLeader, get("heartbeatMs")));
  S.batcher = new Batcher({ debounceMs: get("debounceMs"), maxWaitMs: get("maxWaitMs"), onFlush: (o) => flush(o) });
  if (S.outbox.items.some(i => i.attempts === 0)) S.batcher.push(); // unsent events from before a reload
  S.batcher.at(S.outbox.nextDueAt());
  tickLeader();
  ackRelayStaleChat();
  F.seedSnapshots();
  try { armPresenceResumeTimer(readSuspendUntil()); } catch {}
}
// v0.6: one feature event into the outbox (idempotent by eventId).
function emitEvent(ev, { urgent = false, evenIfPaused = false } = {}) {
  if (!enabled() || !amLeader() || !S.outbox) return false;
  if (!evenIfPaused && get("aiPaused")) return false; const now = Date.now();
  if (!S.dedupe.claim(ev.eventId, now)) return false;
  S.outbox.enqueue(ev, now); S.dedupe.mark(ev.eventId, "sent", now); persistNow(); S.metrics.inc("woke"); S.batcher?.push({ urgent, at: now }); return true;
}

function tickLeader() {
  const now = Date.now(); S.batcher?.check();
  maybeProbeLink(now);
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
  ackRelayStaleChat();
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
  if (data.type === "heartbeat") { S.leader = applyHeartbeat(S.leader, data, Date.now()); refreshStatus(); return; }
  if (data.type === "turnPing") return F.onTurnPing(data);
  if (data.type === "bubble") return F.showBubble(data);
  if (data.type === "voice") { S.lastReplyAt = Date.now(); }
  if (data.type === "voice") { thinking.hide(); return void onVoiceSocket(data); } // #12: players play bot voice locally
  if (data.type === "thinking") { if (data.on) thinking.show(data.timeoutMs, { kind: data.kind || "thinking", note: data.note ?? null }); else thinking.hide(); if (data.lastReplyAt) S.lastReplyAt = data.lastReplyAt; refreshStatus(); return; } // #14
  if (data.type === "stuckCleared") {
    if (!amLeader()) clearLocalOutbox();
    if (game.user?.isGM) ui.notifications?.info?.(formatClearedStuck(data.count, loc));
    refreshPanel();
    return;
  }
  if (data.type === "sessionControl" && amLeader()) {
    if (data.action === "start") return void doStart();
    if (data.action === "pause") return void doPause();
    return;
  }
  if (data.type === "gmControl" && amLeader()) return void handleGmControl(data);
  if (data.type === "ack" && amLeader() && Array.isArray(data.eventIds)) game.modules.get(ID).api.ack(data.eventIds);
}

Hooks.on("createChatMessage", async (msg) => {
  if (enabled() && isBot(msg.author ?? msg.user ?? {})) thinking.hide(); // #14: bot spoke (runs on every client)
  if (enabled() && msg.flags?.[ID]?.rollRequest) thinkingOn({ kind: "rolling" });
  if (enabled() && isBot(msg.author ?? msg.user ?? {})) { S.lastReplyAt = Date.now(); refreshStatus(); }
  if (enabled() && msg.flags?.[ID]?.rollRequest) refreshPanel();
  if (!enabled() || !amLeader()) return;
  if (msg.flags?.[ID]?.local) return; // our own cards/replies never wake the bot
  if (isOwnShipCard(msg)) return; // v0.8 morale/ship cards we posted
  if ((msg.rolls?.length || msg.flags?.pirateborg?.outcomes?.length) && await F.onRollMessage(msg).catch(e => (log("rollRequest", e?.message), false))) return;
  handleChat(msg);
});
Hooks.on("updateChatMessage", (msg) => { if (enabled() && msg.flags?.[ID]?.rollRequest) refreshPanel(); });
Hooks.on("renderChatMessageHTML", (msg, html) => { if (enabled()) { F.bindRollCard(msg, html); enhanceVoiceMessage(msg, html, { t: loc, replay: (src, meta) => audioQueue.enqueue(`replay:${src}:${Date.now()}`, { src, text: meta?.text }) }); } });
Hooks.on("updateActor", (a, change) => { if (enabled() && amLeader()) F.onActorUpdate(a, change); if (enabled()) refreshPanel(); });
Hooks.on("createActor", (a) => { if (enabled() && amLeader()) F.onActorUpdate(a, {}); if (enabled()) refreshPanel(); });
Hooks.on("deleteActor", () => { if (enabled()) refreshPanel(); });
Hooks.on("createToken", () => { if (enabled()) refreshPanel(); });
Hooks.on("updateToken", () => { if (enabled()) refreshPanel(); });
Hooks.on("deleteToken", () => { if (enabled()) refreshPanel(); });
Hooks.on("createItem", (i) => { if (enabled() && amLeader()) F.onItemCreate(i); });
Hooks.on("deleteCombat", (c) => { if (enabled()) thinking.hide(); if (enabled()) refreshStatus(); if (enabled() && amLeader()) { F.onCombatDelete(c); F.cancelCombatRolls(c).catch(e => log("cancelCombatRolls", e?.message)); combatState(c, "end"); } }); // v0.8.6: hide runs on every client
// v0.8.3: only the leader (bot user, else active GM) sends; eventId dedupe means one start/end per combat.
async function applyStoredMood(mood) {
  const mapping = parseMoodPlaylists(get("moodPlaylists"));
  const playlists = game.playlists?.contents ?? game.playlists ?? [];
  const r = await applyMood(mood, {
    playlists, mapping, currentId: moodState().playlistId,
    playAll: async (pl) => pl.playAll?.(),
    stopAll: async (pl) => pl.stopAll?.()
  });
  if (r.ok) { moodState().current = r.mood; moodState().playlistId = r.playlistId ?? null; }
  else log("setMood", r.error);
}
function syncCombatMood(state) {
  if (!enabled() || !amLeader() || get("moodFollowsCombat") === false) return;
  const run = state === "start" ? (rememberMood(), applyStoredMood("combat")) : applyStoredMood(restoreMoodKey());
  Promise.resolve(run).catch(e => log("setMood", e?.message));
}
function combatState(c, state) {
  const neverStarted = state === "end" && !c?.started && !(c?.round > 0);
  if (!neverStarted) syncCombatMood(state);
  if (!enabled() || !amLeader() || !get("combatEvents")) return;
  if (state === "end") thinkingOff({ broadcast: true }); // v0.8.6
  if (neverStarted) return;
  const ev = combatEvent(c, state, { users: game.users?.contents ?? [] }); if (ev) emitEvent(ev, { urgent: true });
}
Hooks.on("combatStart", (c) => combatState(c, "start"));
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
  if (/^\s*start\s*$/i.test(plain) && get("unpauseOnStart")) { doStart().catch(e => log("start", e?.message)); return; }
  if (/^\s*pause\s*$/i.test(plain) && author?.isGM) { doPause().catch(e => log("pause", e?.message)); return; }
  if (authorId !== botId && get("localCommands") && tryLocal(msg, plain, author)) return;
  if (get("aiPaused")) return;
  const ev = { eventId, type: "chat", authorId, author: author?.name,
    speaker: msg.speaker?.alias ?? null, whisper: msg.whisper ?? [], text: msg.content ?? "",
    rolls: [...(msg.rolls ?? []).map(r => { const b = rollBreakdown(r); return { formula: r.formula, total: r.total, ...(b ? { breakdown: b.text, dice: b.dice, modifier: b.modifier } : {}) }; }), ...(msg.flags?.pirateborg?.outcomes ?? []).filter(o => o?.roll).map(o => { const r = o.roll; const b = rollBreakdown(r); return { formula: r.formula ?? o.formula, total: r.total, ...(b ? { breakdown: b.text, dice: b.dice, modifier: b.modifier } : {}) }; })], // v0.8.6
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
  const gmOnly = cmd.name === "music" || cmd.name === "scene" || ["saveSession", "loadSession", "setPet", "listPets", "placePets", "start", "pause", "rollTable", "giveLoot", "rollLoot", "applyDamage", "startShipCombat", "shipStatus", "setMood"].includes(cmd.name);
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
    else if (cmd.name === "setupCheck" && r.ok) await reply(r.result.warning || r.result.text);
    else if (cmd.name === "getShip" && r.ok) { const x = r.result; await reply(`${x.name}: HP ${x.hp.value}/${x.hp.max}, hull ${x.armorDie}, crew ${x.crew.value}/${x.crew.max}, shanties ${x.shanties.value}/${x.shanties.max}${x.sinking ? ", sinking" : ""}`); }
    else if ((cmd.name === "saveSession" || cmd.name === "loadSession") && r.ok) await reply(r.result.recap || formatSessionRecap(r.result));
    else if (cmd.name === "rollTable" && r.ok) await reply(r.result.text ? `${r.result.table}: ${r.result.text}` : (r.result.table || "rolled"));
    else if (!r.ok) await reply(`${cmd.name}: ${r.error}`);
  })().catch(e => log("local command failed", e?.message));
  return true;
}

// v0.4 token lock: runs on the editing client, independent of leader/enabled so a lock always holds.
Hooks.on("preUpdateToken", (doc, change, _o, userId) => {
  const lock = doc.flags?.[ID]?.lock; if (!lock) return;
  const u = game.users.get(userId) ?? game.user;
  if (lockBlocks(lock, change, u?.isGM)) { if (userId === game.user.id) ui.notifications?.warn("That token is locked by the AI GM Pirate Borg."); return false; }
});
// Deleted chat message: drop its queued event so the bot never sees it.
Hooks.on("deleteChatMessage", (msg) => {
  if (enabled() && msg.flags?.[ID]?.rollRequest) refreshPanel();
  if (!enabled() || !amLeader() || !S.outbox) return;
  if (S.outbox.dropWhere(e => e.eventId === `chat:${msg.id}`).length) { S.metrics.inc("dropDeleted"); persistNow(); }
});
Hooks.on("updateCombat", (c, change) => {
  try { crewTracker.sync(c); } catch {}
  if (!enabled() || !amLeader() || !("turn" in change || "round" in change)) return;
  if (startedNow(c, change)) combatState(c, "start"); // combatStart only fires on the starting client
  F.onCombatUpdate(c, change);
  if (get("turnPrompts")) F.turnPrompt(c).catch(e => log("turnPrompt", e?.message));
  if (!shouldWakeOnTurn(c, get("turnWake"), game.users?.contents ?? [])) return; // NPC/monster turns only; PC turns stay local
  const eventId = `combat:${c.id}:${c.round}.${c.turn}`; const now = Date.now();
  if (!S.dedupe.claim(eventId, now)) return;
  const info = F.turnStatus() || {};
  S.outbox.enqueue({ eventId, type: "turn", combat: { id: c.id, round: c.round, turn: c.turn }, combatant: c.combatant?.name ?? null,
    isNPC: combatantIsNpc(c.combatant, game.users?.contents ?? []),
    ...(info.isPet ? { isPet: true, simpleAction: info.simpleAction !== false, ...(info.petOwner ? { petOwner: info.petOwner } : {}) } : {}),
    ...(info.isShip ? { isShip: true } : {}) }, now);
  S.dedupe.mark(eventId, "sent", now); persistNow(); S.batcher?.push({ urgent: true });
});
Hooks.on(`${ID}.shipCombat`, (data) => {
  if (!enabled() || !amLeader() || !data) return;
  const ships = (data.ships ?? []).map(s => ({
    name: s.name, actorId: s.actorId ?? null, tokenId: s.tokenId ?? null,
    hp: s.hp ?? null, crew: s.crew ?? null, hull: s.hull ?? null
  }));
  const key = `${data.combatId || "none"}:${ships.map(s => s.tokenId || s.actorId || s.name).join(",")}`;
  emitEvent({ eventId: `shipCombat:${key}`, type: "shipCombat", state: "start", combatId: data.combatId ?? null, ships }, { urgent: true });
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
  const batch = S.outbox.nextBatch(now, game.world.id, { retriesOnly: !!(opts.retry && opts.burstOpen), ...(get("aiPaused") ? { onlyTypes: ["control"] } : {}) });
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
    if (shouldShowThinking(batch.events, batch.attempt)) { S.lastWake = { eventIds: batch.events.filter(e => ["chat", "rollResult"].includes(e.type)).map(e => e.eventId), at: Date.now() }; thinkingOn({ kind: "waking" }); } // #14
    // Relay: chat, combat, turns, and roll-request outcomes are handed to the GM via the socket/hook. Mark them received so they are not retried. Do not clear thinking — the GM has not replied yet. Control still waits for api.ack. Direct mode unchanged.
    if (get("delivery") === "relay") ackRelayChatIds(relayAutoAckIds(payload.events));
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

// 0.8.7: warn the GM when a scene shows grey because its background is unset or the file is missing (v14 keeps it on levels[0]).
Hooks.on("canvasReady", async (c) => {
  if (!game.user?.isGM) return; const scene = c?.scene; if (!scene) return;
  const src = sceneBackgroundSrc(scene);
  let missing = !src;
  if (src) { try { missing = !(await fetch(src, { method: "HEAD" })).ok; } catch { missing = true; } }
  if (missing) ui.notifications?.warn(`AI GM Pirate Borg: scene "${scene.name}" has ${src ? `a missing background file (${src})` : "no background image"}. On Foundry v14 set it on the scene's level (setBackground command does this).`);
});
