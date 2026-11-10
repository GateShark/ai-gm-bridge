// Typed command registry (allow-list, no eval). Every handler returns {ok,result} | {ok:false,code,error}.
import { ok, fail, validate, checkExpect } from "./lib/result.mjs";
import { KeyedMutex } from "./lib/mutex.mjs";
import { priorReply, recordReply, resolveReplyTo } from "./lib/replies.mjs";
import { waitForPosition } from "./lib/movewait.mjs";
import { moveWithFallback, setSceneBackground, formatResult } from "./lib/v081.mjs";
import { VoiceCache, shouldSkipTts } from "./lib/voicecache.mjs";
import { unwrapText } from "./lib/v081.mjs";
import { AudioQueue, voiceOrText, showAudioUnlockPrompt } from "./lib/audioqueue.mjs";
import { planUpload, DEFAULT_LIMITS, UPLOAD_ROOT } from "./lib/uploads.mjs";
import { buildSpawn, LOCK_SCOPES } from "./lib/spawn.mjs";
import * as F from "./features.mjs";
import { getContext } from "./context.mjs";
import * as SHIP from "./ship.mjs";
import { targetActor, targetInfo, sceneTokenForActor } from "./lib/target.mjs";
import { combatExpect } from "./lib/turns.mjs";
import { liveSetupCheck } from "./lib/setupcheck.mjs";
import { normalizeGmStatus } from "./lib/gmstatus.mjs";
import { runLinkProbe, findBotUser, callerConnectionError, PING_TIMEOUT_ERROR, publicPresence, resolvePresenceSuspendSeconds } from "./lib/presence.mjs";
const MODULE_ID = "ai-gm-bridge";

function withReplyTo(a, ctx) {
  const replyTo = resolveReplyTo(a?.replyTo, ctx?.lastWake);
  return replyTo ? { ...a, replyTo } : a;
}

function settingOf(g, key, fallback = "") {
  try { return g?.settings?.get?.(MODULE_ID, key) ?? fallback; } catch { return fallback; }
}
function livePresenceFields(now = Date.now()) {
  const g = globalThis.game;
  const botUserId = settingOf(g, "botUserId");
  const botUserName = settingOf(g, "botUserName");
  const bot = findBotUser(g?.users, { botUserId, botUserName });
  let probe = null;
  try { probe = g?.settings?.get?.(MODULE_ID, "linkProbe"); } catch { probe = null; }
  return publicPresence({
    now, worldId: g?.world?.id ?? null, botUser: bot, probe, botUserId: bot?.id || botUserId
  });
}
async function runPing() {
  const g = globalThis.game;
  const now = Date.now();
  const fields = () => livePresenceFields(now);
  const conn = callerConnectionError({ user: g?.user, socket: g?.socket, ready: g?.ready });
  if (conn) return fail(503, conn, fields());
  if (!g?.settings?.set || !g?.settings?.get) return fail(503, "Not connected: Foundry is not ready.", fields());
  const botUserId = settingOf(g, "botUserId");
  const botUserName = settingOf(g, "botUserName");
  const bot = findBotUser(g?.users, { botUserId, botUserName });
  const outcome = await runLinkProbe({
    now,
    userId: g.user?.id ?? "",
    isBotWriter: !!(g.user && bot && g.user.id === bot.id),
    setSetting: (v) => g.settings.set(MODULE_ID, "linkProbe", v),
    getSetting: () => g.settings.get(MODULE_ID, "linkProbe")
  });
  const result = livePresenceFields(now);
  if (outcome.ok) return ok(result);
  return fail(504, outcome.error || PING_TIMEOUT_ERROR, result);
}

import { resolveResource, nextValue, summarize, parseAmount } from "./lib/pirateborg.mjs";
import { collectSessionSnapshot, formatSessionRecap, applySessionHpPlan } from "./lib/session.mjs";
import { readPetFlag, petFlagData, listPetsFrom, planPetPlacement } from "./lib/pets.mjs";
import { listTables, planDamage, planLoot, summarizeDraw, normalizeTargetArgs } from "./lib/quickgm.mjs";
import { collectShips, crewTracker, planShipFight } from "./lib/shiptrack.mjs";
import { sceneTokens } from "./lib/gmpanel.mjs";
import { readActorHp } from "./lib/hp.mjs";

// Class item's own label for extraResource (e.g. "Prayers"); field name varies, so search string fields.
function extraLabel(actor) {
  // pirateborg: Actor#extraResourceNamePlural (class, else base class) <- class item system.extraResourceNamePlural ("Prayers", "Sorceries", or "")
  if (typeof actor.extraResourceNamePlural === "string" && actor.extraResourceNamePlural) return actor.extraResourceNamePlural;
  for (const i of actor.items?.filter?.(i => i.type === "class") ?? []) { const v = i.system?.extraResourceNamePlural || i.system?.extraResourceNameSingular; if (v) return v; }
  return "";
}
function playClip({ src, volume = 0.8 }) {
  return new Promise(async (resolve, reject) => {
    try {
      if (game.audio?.locked) { const e = new Error("autoplay blocked"); e.blocked = true; throw e; }
      const sound = await foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false); // local only: each client plays via its own queue (#12)
      if (!sound) throw new Error("clip did not start");
      let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
      sound?.addEventListener?.("end", fin);
      const ms = (sound?.duration && isFinite(sound.duration) ? sound.duration * 1000 : 30000) + 500;
      setTimeout(fin, Math.min(ms, 180000));
    } catch (e) { reject(e); }
  });
}
export const audioQueue = new AudioQueue({ play: playClip, onBlocked: () => showAudioUnlockPrompt({
  queue: audioQueue, label: game.i18n?.localize?.("AIGM.audio.enableSound") || game.i18n?.localize?.("AIGM.audio.unlock") || "Enable sound",
  beforeUnlock: async () => { await game.audio?.unlock; try { await game.audio?.context?.resume?.(); } catch {} } }) });
// #12: the core AudioHelper broadcast (play(data, true)) did not reach player clients in v14 and bypassed their
// queue/unlock prompt. Instead emit on the module socket; every client (players included) plays through its own audioQueue.
export const VOICE_SOCKET = "module.ai-gm-bridge";
export function voiceAll(id, clip, g = globalThis.game) {
  try { g?.socket?.emit?.(VOICE_SOCKET, { type: "voice", id, src: clip.src, volume: clip.volume }); } catch {}
  return audioQueue.enqueue(id, clip);
}
export function onVoiceSocket(data) {
  if (data?.type !== "voice" || typeof data.src !== "string" || !data.src) return null;
  return audioQueue.enqueue(data.id ?? data.src, { src: data.src, volume: typeof data.volume === "number" ? data.volume : undefined });
}
const checkAudio = async (src) => { try { return (await fetch(src, { method: "HEAD" })).ok; } catch { return false; } };
const speaker = (alias) => alias ? { alias } : ChatMessage.getSpeaker();
async function ackAfter(ctx, ids) { if (Array.isArray(ids) && ids.length) await ctx.ack?.(ids); }

const combatLock = new KeyedMutex();
const liveCombat = (c) => c ? { combatId: c.id, round: c.round, turn: c.turn } : null;
const findActor = (a) => game.actors.get(a.actorId) ?? game.actors.getName?.(a.actorName) ?? null;
// #13: tokenId/tokenName target that token; unlinked tokens are written through token.actor, not the base actor.
const TOK = { tokenId: "string?", tokenName: "string?", sceneId: "string?" };
const TARGET = { ...TOK, tokenIds: "array?", tokenNames: "array?", actorId: "string?", actorName: "string?", actorIds: "array?", actorNames: "array?" };
function findTarget(a) {
  if (a.tokenId || a.tokenName) { const t = findToken(a); if (!t) return { error: fail(404, "token not found") };
    const base = (a.actorId || a.actorName) ? findActor(a) : null; const r = targetActor({ token: t, baseActor: base }); return r ?? { error: fail(404, "actor not found") }; }
  const base = (a.actorId || a.actorName) ? findActor(a) : null;
  const scene = a.sceneId ? game.scenes.get(a.sceneId) : globalThis.canvas?.scene ?? game.scenes?.viewed ?? game.scenes?.active;
  const tok = sceneTokenForActor(scene?.tokens, { actor: base, actorId: a.actorId, actorName: a.actorName });
  if (tok) { const r = targetActor({ token: tok, baseActor: base }); if (r) return r; }
  const r = targetActor({ baseActor: base }); return r ?? { error: fail(404, "actor not found") };
}
function findToken(a) {
  const scene = a.sceneId ? game.scenes.get(a.sceneId) : canvas?.scene ?? game.scenes.active;
  if (!scene) return null;
  return scene.tokens.get(a.tokenId) ?? scene.tokens.find(t => t.name === a.tokenName) ?? null;
}

const FP = () => globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const setting = (k, d) => { try { return game.settings.get("ai-gm-bridge", k) ?? d; } catch { return d; } };
function uploadLimits() {
  const mb = Number(setting("uploadMaxMB", 8)); const types = String(setting("uploadTypes", "") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return { maxBytes: Math.max(0.01, mb) * 1024 * 1024, allowed: types.length ? types : DEFAULT_LIMITS.allowed };
}
async function ensureDir(fp, dir) {
  let acc = ""; for (const part of dir.split("/")) { acc = acc ? `${acc}/${part}` : part; try { await fp.createDirectory("data", acc, {}); } catch { /* exists */ } }
}
const spawnLock = new KeyedMutex();


function currentScene() {
  return globalThis.canvas?.scene ?? game.scenes?.viewed ?? game.scenes?.active ?? null;
}
function sessionApi(name, args = {}) {
  const fn = game.modules?.get?.(MODULE_ID)?.api?.[name];
  return typeof fn === "function" ? fn(args) : null;
}
async function placePetsOnScene(scene) {
  scene = scene ?? currentScene();
  if (!scene) return { error: "no scene" };
  const tokens = sceneTokens(scene);
  const pets = listPetsFrom(game.actors, { readPet: readPetFlag });
  const grid = scene.grid?.size ?? 100;
  const plan = planPetPlacement({ pets, tokens, grid });
  const done = [];
  for (const step of plan) {
    if (step.action === "move") {
      const tok = scene.tokens?.get?.(step.tokenId);
      if (tok?.update) await tok.update({ x: step.x, y: step.y });
      done.push(step);
    } else if (step.action === "create") {
      const actor = game.actors?.get?.(step.actorId);
      if (!actor) continue;
      const proto = actor.prototypeToken?.toObject?.() ?? {};
      const created = await scene.createEmbeddedDocuments?.("Token", [{ ...proto, actorId: actor.id, x: step.x, y: step.y, name: actor.name }]);
      done.push({ ...step, tokenId: created?.[0]?.id ?? null });
    } else done.push(step);
  }
  return done;
}

export const COMMANDS = {
  getState: { schema: {}, async run() {
    const c = game.combat;
    return ok({ world: game.world.id, paused: game.paused, scene: game.scenes.active?.id ?? null,
      combat: c ? { ...liveCombat(c), combatant: c.combatant?.name ?? null } : null });
  }},
  // v0.7 GM-only context: returned to the caller only (never posted, whispered or emitted).
  getContext: { schema: { scene: "string?", journals: "any?", maxChars: "number?", since: "string?", full: "boolean?" }, async run(a) {
    return getContext(game, a);
  }},
  setHP: { schema: { actorId: "string?", actorName: "string?", ...TOK, value: "any?", delta: "any?", path: "string?" }, async run(a) {
    const amt = parseAmount(a); if (amt.error) return fail(400, amt.error);
    const tg = findTarget(a); if (tg.error) return tg.error; const actor = tg.actor;
    let path = a.path ?? game.settings.get("ai-gm-bridge", "hpPath");
    if (!a.path && game.system.id === "pirateborg") { const r = resolveResource(actor.type, "hp"); if (r.error) return fail(400, r.error); path = r.base + ".value"; }
    const before = foundry.utils.getProperty(actor, path);
    const parent = path.endsWith(".value") ? foundry.utils.getProperty(actor, path.slice(0, -6)) : null;
    const after = nextValue(parent && typeof parent === "object" ? parent : { value: before }, amt);
    await actor.update({ [path]: after });
    return ok({ actorId: actor.id, ...targetInfo(tg), path, before, after: foundry.utils.getProperty(actor, path) });
  }},
  move: { schema: { tokenId: "string?", tokenName: "string?", sceneId: "string?", x: "number", y: "number" }, async run(a) {
    const t = findToken(a); if (!t) return fail(404, "token not found");
    const r = await moveWithFallback(t, a.x, a.y, () => waitForPosition(t, a.x, a.y, { on: (h, f) => Hooks.on(h, f), off: (h, id) => Hooks.off(h, id) }));
    if (!r.reached) return fail(504, "token did not reach the requested position", { tokenId: t.id, x: r.x, y: r.y, requested: { x: a.x, y: a.y }, via: r.via });
    return ok({ tokenId: t.id, x: r.x, y: r.y, ...(r.via === "displace" ? { via: "displace" } : {}) });
  }},
  nextTurn: { schema: { expect: "object?" }, async run(a) {
    const key = a.expect?.combatId ?? game.combat?.id ?? "none";
    return combatLock.run(key, async () => {
      const c = (a.expect?.combatId ? game.combats.get(a.expect.combatId) : null) ?? game.combat;
      const live = c?.started ? { ...liveCombat(c), combatant: c.combatant?.name ?? null } : null;
      const stale = checkExpect(live, a.expect); if (stale) return stale;
      await c.nextTurn();
      return ok({ ...liveCombat(c), combatant: c.combatant?.name ?? null, expect: combatExpect(c) });
    });
  }},
  endCombat: { schema: { expect: "object?" }, async run(a) {
    const c = a.expect ? game.combats.get(a.expect.combatId) : game.combat;
    if (!c) return fail(404, "no combat");
    return combatLock.run(c.id, async () => {
      if (a.expect) { const stale = checkExpect({ ...liveCombat(c), combatant: c.combatant?.name ?? null }, a.expect); if (stale) return stale; }
      const id = c.id; await c.delete(); // direct delete: no confirm dialog
      return ok({ ended: id });
    });
  }},
  scene: { schema: { sceneId: "string?", sceneName: "string?", activate: "boolean?" }, async run(a) {
    const s = game.scenes.get(a.sceneId) ?? game.scenes.getName?.(a.sceneName); if (!s) return fail(404, "scene not found");
    if (a.activate === false) await s.view(); else await s.activate();
    return ok({ sceneId: s.id, active: s.active });
  }},
  setBackground: { schema: { sceneId: "string?", sceneName: "string?", src: "string" }, async run(a) {
    const s = (a.sceneId || a.sceneName) ? (game.scenes.get(a.sceneId) ?? game.scenes.getName?.(a.sceneName)) : (canvas?.scene ?? game.scenes.active);
    if (!s) return fail(404, "scene not found");
    return ok({ sceneId: s.id, ...(await setSceneBackground(s, a.src)) });
  }},
  format: { schema: { result: "any" }, async run(a) { return ok({ text: formatResult(a.result) }); } },
  music: { schema: { playlist: "string", sound: "string?", action: "string?" }, async run(a) {
    const p = game.playlists.get(a.playlist) ?? game.playlists.getName?.(a.playlist); if (!p) return fail(404, "playlist not found");
    const action = a.action ?? "play";
    if (action === "stop") { await p.stopAll(); return ok({ playlist: p.id, playing: false }); }
    if (a.sound) { const s = p.sounds.find(x => x.id === a.sound || x.name === a.sound); if (!s) return fail(404, "sound not found"); await p.playSound(s); }
    else await p.playAll();
    return ok({ playlist: p.id, playing: true, sound: a.sound ?? null });
  }},
  roll: { schema: { formula: "string", flavor: "string?", toChat: "boolean?" }, async run(a) {
    let roll; try { roll = await new Roll(a.formula).evaluate(); } catch (e) { return fail(400, `bad formula: ${e.message}`); }
    let messageId = null;
    if (a.toChat !== false) messageId = (await roll.toMessage({ flavor: a.flavor ?? "" }))?.id ?? null;
    return ok({ formula: roll.formula, total: roll.total, messageId });
  }},
  unpause: { schema: {}, async run() { if (game.paused) game.togglePause(false, { broadcast: true }); return ok({ paused: false }); } },
  getResources: { schema: { actorId: "string?", actorName: "string?", ...TOK }, async run(a) {
    const tg = findTarget(a); if (tg.error) return tg.error; const actor = tg.actor;
    return ok({ actorId: actor.id, ...targetInfo(tg), name: actor.name, type: actor.type, resources: summarize(actor.type, actor.system, extraLabel(actor)) });
  }},
  setResource: { schema: { actorId: "string?", actorName: "string?", ...TOK, resource: "string", value: "any?", delta: "any?" }, async run(a) {
    const amt = parseAmount(a); if (amt.error) return fail(400, amt.error); a = { ...a, ...amt }; delete a[amt.value === undefined ? "value" : "delta"];
    const tg = findTarget(a); if (tg.error) return tg.error; const actor = tg.actor;
    const r = resolveResource(actor.type, a.resource, extraLabel(actor)); if (r.error) return fail(400, r.error);
    const cur = foundry.utils.getProperty(actor, r.base); const after = nextValue(cur, a);
    await actor.update({ [r.base + ".value"]: after });
    return ok({ actorId: actor.id, ...targetInfo(tg), resource: r.label ?? r.key, path: r.base + ".value", before: cur?.value, after: foundry.utils.getProperty(actor, r.base + ".value") });
  }},
  whisper: { schema: { content: "string", to: "array", speakerAlias: "string?", replyTo: "string?", ackEventIds: "array?" }, async run(a, ctx) { a = withReplyTo(a, ctx); if ("content" in a) a.content = unwrapText(a.content);
    if (!Array.isArray(a.to) || !a.to.length) return fail(400, "to must be a non-empty array of user ids or names");
    const users = a.to.map(x => game.users.get(x) ?? game.users.getName?.(x)); if (users.some(u => !u)) return fail(404, "unknown recipient");
    const prev = priorReply(ctx.dedupe, a.replyTo); if (prev) { await ackAfter(ctx, a.ackEventIds); return ok({ messageId: prev, duplicate: true }); }
    const m = await ChatMessage.create({ content: a.content, whisper: users.map(u => u.id), speaker: speaker(a.speakerAlias), flags: { "ai-gm-bridge": { replyTo: a.replyTo ?? null } } });
    recordReply(ctx.dedupe, a.replyTo, m.id, Date.now()); await ctx.persistNow(); await ackAfter(ctx, a.ackEventIds);
    return ok({ messageId: m.id, to: users.map(u => u.name) });
  }},
  playAudio: { schema: { path: "string", id: "string?", volume: "number?", wait: "boolean?" }, async run(a) {
    if (!(await checkAudio(a.path))) return fail(404, "audio not reachable");
    const p = voiceAll(a.id ?? a.path, { src: a.path, volume: a.volume });
    if (a.wait) return ok(await p);
    return ok({ id: a.id ?? a.path, queued: true, queueLength: audioQueue.length });
  }},
  // Reply with voice (uploaded mp3 path) and fall back to text if the audio is missing or the post fails.
  // ackEventIds are acked only after a post succeeds.
  // Ask before generating TTS: {cached:path} = reuse it (call postVoice without audioPath); {skipTts:true} = reply as text.
  voiceLookup: { schema: { content: "string", voice: "string?" }, async run(a, ctx) { if ("content" in a) a.content = unwrapText(a.content);
    if (shouldSkipTts(a.content, ctx.ttsMinChars ?? 0)) return ok({ skipTts: true, cached: null });
    return ok({ skipTts: false, cached: ctx.voiceCache?.get(a.content, a.voice) ?? null });
  }},
  postVoice: { schema: { content: "string", audioPath: "string?", voice: "string?", replyTo: "string?", speakerAlias: "string?", ackEventIds: "array?" }, async run(a, ctx) { a = withReplyTo(a, ctx); if ("content" in a) a.content = unwrapText(a.content);
    const prev = priorReply(ctx.dedupe, a.replyTo); if (prev) { await ackAfter(ctx, a.ackEventIds); return ok({ messageId: prev, duplicate: true }); }
    const flags = { "ai-gm-bridge": { replyTo: a.replyTo ?? null } };
    let audioPath = a.audioPath, cacheHit = false, skippedTts = false;
    if (shouldSkipTts(a.content, ctx.ttsMinChars ?? 0)) { audioPath = undefined; skippedTts = true; ctx.metrics?.inc("ttsSkipped"); }
    else if (!audioPath && ctx.voiceCache) { audioPath = ctx.voiceCache.get(a.content, a.voice) ?? undefined; cacheHit = !!audioPath; if (cacheHit) ctx.metrics?.inc("voiceCacheHits"); }
    const r = await voiceOrText({ audioPath, checkAudio,
      playVoice: (src) => voiceAll(a.replyTo ?? src, { src }),
      postVoice: async (src) => (await ChatMessage.create({ content: `${a.content}<audio controls preload="none" src="${foundry.utils.escapeHTML?.(src) ?? src}"></audio>`, speaker: speaker(a.speakerAlias), flags })).id,
      postText: async () => (await ChatMessage.create({ content: a.content, speaker: speaker(a.speakerAlias), flags })).id });
    if (r.mode === "voice" && a.audioPath && ctx.voiceCache) { ctx.voiceCache.put(a.content, a.audioPath, a.voice); ctx.persistVoice?.(); }
    recordReply(ctx.dedupe, a.replyTo, r.messageId, Date.now()); await ctx.persistNow(); await ackAfter(ctx, a.ackEventIds);
    return ok({ ...r, cacheHit, skippedTts });
  }},
  tokenUpdate: { schema: { tokenId: "string?", tokenName: "string?", sceneId: "string?", hidden: "boolean?", elevation: "number?", rotation: "number?", alpha: "number?" }, async run(a) {
    const t = findToken(a); if (!t) return fail(404, "token not found");
    const upd = {}; for (const k of ["hidden", "elevation", "rotation", "alpha"]) if (a[k] !== undefined) upd[k] = a[k];
    if (!Object.keys(upd).length) return fail(400, "nothing to update");
    await t.update(upd); return ok({ tokenId: t.id, ...upd });
  }},
  // v0.4: token lock. scope "move" blocks position/rotation changes by players; "all" blocks every player edit. GMs are never blocked.
  lockToken: { schema: { tokenId: "string?", tokenName: "string?", sceneId: "string?", locked: "boolean", scope: "string?" }, async run(a) {
    const t = findToken(a); if (!t) return fail(404, "token not found");
    const scope = a.scope ?? "move"; if (!LOCK_SCOPES.includes(scope)) return fail(400, `scope must be one of ${LOCK_SCOPES.join(", ")}`);
    await t.update({ locked: a.locked, "flags.ai-gm-bridge.lock": a.locked ? scope : null });
    return ok({ tokenId: t.id, locked: a.locked, scope: a.locked ? scope : null });
  }},
  // v0.4: GM-only upload of base64 data into ai-gm-uploads/<kind>/<hash>-<name>. Same bytes => same path, no re-upload.
  upload: { schema: { name: "string", data: "string", kind: "string?" }, async run(a) {
    if (!game.user?.isGM) return fail(403, "uploads are GM-only");
    if (setting("uploadsEnabled", true) === false) return fail(403, "uploads are disabled in settings");
    const p = planUpload(a, uploadLimits()); if (p.error) return fail(p.code, p.error);
    const fp = FP(); if (!fp) return fail(501, "FilePicker unavailable");
    try { const b = await fp.browse("data", p.dir); if ((b?.files ?? []).some(f => decodeURIComponent(f).endsWith(`/${p.fileName}`))) return ok({ path: p.path, bytes: p.bytes.length, existed: true }); } catch { /* dir missing */ }
    await ensureDir(fp, p.dir);
    const file = new File([p.bytes], p.fileName, { type: p.mime });
    const r = await fp.upload("data", p.dir, file, {}, { notify: false });
    if (r === false || r?.status === "error") return fail(502, r?.message ?? "upload failed");
    return ok({ path: r?.path ?? p.path, bytes: p.bytes.length, existed: false });
  }},
  // v0.4: place an actor's token with vision/light. spawnKey makes it idempotent (returns the existing token).
  spawnAndVision: { schema: { actorId: "string?", actorName: "string?", sceneId: "string?", x: "number", y: "number", name: "string?", hidden: "boolean?",
    elevation: "number?", disposition: "number?", vision: "object?", light: "object?", locked: "boolean?", lockScope: "string?", spawnKey: "string?" }, async run(a) {
    const actor = findActor(a); if (!actor) return fail(404, "actor not found");
    const scene = a.sceneId ? game.scenes.get(a.sceneId) : canvas?.scene ?? game.scenes.active; if (!scene) return fail(404, "scene not found");
    if (a.lockScope && !LOCK_SCOPES.includes(a.lockScope)) return fail(400, `lockScope must be one of ${LOCK_SCOPES.join(", ")}`);
    const d = buildSpawn(a); if (d.error) return fail(400, d.error);
    return spawnLock.run(scene.id, async () => {
      if (a.spawnKey) { const ex = scene.tokens.find(t => t.getFlag?.("ai-gm-bridge", "spawnKey") === a.spawnKey || t.flags?.["ai-gm-bridge"]?.spawnKey === a.spawnKey);
        if (ex) return ok({ tokenId: ex.id, sceneId: scene.id, duplicate: true }); }
      const td = await actor.getTokenDocument(d);
      const [t] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
      return ok({ tokenId: t.id, sceneId: scene.id, x: t.x, y: t.y, sight: t.sight?.enabled ?? null, light: t.light ? { dim: t.light.dim, bright: t.light.bright } : null });
    });
  }},
  // v0.4: change vision/light on an existing token.
  setVision: { schema: { tokenId: "string?", tokenName: "string?", sceneId: "string?", vision: "object?", light: "object?" }, async run(a) {
    const t = findToken(a); if (!t) return fail(404, "token not found");
    const d = buildSpawn({ x: 0, y: 0, vision: a.vision, light: a.light }); if (d.error) return fail(400, d.error);
    const upd = {}; if (d.sight) upd.sight = d.sight; if (d.light) upd.light = d.light;
    if (!Object.keys(upd).length) return fail(400, "vision or light required");
    await t.update(upd); return ok({ tokenId: t.id, ...upd });
  }},
  // v0.8 Pirate Borg morale + ships (system outcome builders, no dialogs). toChat:false = result only, no card.
  moraleCheck: { schema: { actorId: "string?", actorName: "string?", morale: "any?", toChat: "boolean?" }, async run(a) {
    const actor = a.actorId || a.actorName ? findActor(a) : null; if ((a.actorId || a.actorName) && !actor) return fail(404, "actor not found");
    return SHIP.moraleCheck(actor, a); } },
  shipAction: { schema: { actorId: "string?", actorName: "string?", action: "string", crewActorId: "string?", crewActorName: "string?", dr: "number?", armor: "string?",
    targetTokenId: "string?", targetTokenName: "string?", sceneId: "string?", movement: "number?", toChat: "boolean?" }, async run(a) {
    const actor = findActor(a); if (!actor) return fail(404, "ship not found");
    return SHIP.shipAction(actor, a, { findActor: (x) => findActor(x), findToken }); } },
  shipDamage: { schema: { actorId: "string?", actorName: "string?", ...TOK, amount: "number?", formula: "string?", armor: "boolean?", toChat: "boolean?" }, async run(a) {
    const tg = findTarget(a); if (tg.error) return fail(404, "ship not found"); return SHIP.shipDamage(tg.actor, a); } },
  getShip: { schema: { actorId: "string?", actorName: "string?", ...TOK }, async run(a) {
    const tg = findTarget(a); if (tg.error) return fail(404, "ship not found"); return SHIP.getShip(tg.actor); } },
  // v0.6
  requestRoll: { schema: { user: "string", actorId: "string?", actorName: "string?", stat: "string?", formula: "string?", dr: "number?", label: "string?", requestId: "string?", timeoutMs: "number?", combatId: "string?", replyTo: "string?" },
    async run(a, ctx) { return F.requestRoll(withReplyTo(a, ctx)); } },
  cancelRoll: { schema: { requestId: "string?", messageId: "string?", actorId: "string?", actorName: "string?", label: "string?", user: "string?" }, async run(a) {
    if (!a.requestId && !a.messageId && !a.actorId && !a.actorName && !a.label && !a.user) return fail(400, "requestId, messageId, or actor/label/user is required");
    return F.cancelRollRequest(a.requestId, a); } },
  setGmStatus: { schema: { state: "string", note: "string?", timeoutMs: "number?" }, async run(a) {
    const state = normalizeGmStatus(a.state);
    if (!state) return fail(400, `unknown gm status ${a.state}`);
    return ok({ state, note: a.note != null && String(a.note).trim() ? String(a.note).trim().slice(0, 80) : null, timeoutMs: a.timeoutMs ?? null }); } },
  turnStatus: { schema: {}, async run() {
    const t = F.turnStatus();
    return ok({ active: !!t, ...(t ?? {}), expect: t?.expect ?? null, ...livePresenceFields() });
  } },
  ping: { schema: {}, async run() { return runPing(); } },
  debugSuspendPresence: { schema: { seconds: "number" }, async run(a) {
    const seconds = resolvePresenceSuspendSeconds(a.seconds);
    const until = seconds ? Date.now() + seconds * 1000 : 0;
    await game.settings.set(MODULE_ID, "presenceSuspendUntil", until);
    return ok({ seconds, until, resumed: seconds === 0 });
  } },

  saveSession: { schema: { notes: "string?" }, async run(a) {
    const scene = currentScene();
    const tokens = sceneTokens(scene);
    let prev = {};
    try { prev = game.settings.get(MODULE_ID, "sessionSnapshot") || {}; } catch {}
    const notes = a.notes != null ? a.notes : (prev.notes || "");
    const snap = collectSessionSnapshot({
      scene, combat: game.combat, tokens, notes, now: Date.now(),
      readHp: (act) => readActorHp(act), readPet: (act) => readPetFlag(act)
    });
    snap.recap = formatSessionRecap(snap);
    await game.settings.set(MODULE_ID, "sessionSnapshot", snap);
    return ok(snap);
  } },
  loadSession: { schema: { placePets: "boolean?", applyHp: "boolean?", toChat: "boolean?" }, async run(a) {
    let snap = null;
    try { snap = game.settings.get(MODULE_ID, "sessionSnapshot"); } catch {}
    if (!snap?.savedAt) return fail(404, "no session snapshot saved");
    const recap = formatSessionRecap(snap);
    const placed = a.placePets === false ? [] : await placePetsOnScene();
    const hpApplied = [];
    if (a.applyHp) {
      for (const row of applySessionHpPlan(snap)) {
        const actor = game.actors?.get?.(row.actorId);
        if (!actor) continue;
        if (actor.updateHp) await actor.updateHp({ value: row.value });
        else await actor.update({ "system.attributes.hp.value": row.value });
        hpApplied.push(row);
      }
    }
    if (a.toChat) await ChatMessage.create({ content: recap, speaker: { alias: "AI GM" }, flags: { [MODULE_ID]: { local: true } } });
    return ok({ recap, snapshot: snap, placed, hpApplied });
  } },
  setPet: { schema: { actorId: "string?", actorName: "string?", tokenId: "string?", tokenName: "string?", sceneId: "string?", ownerActorId: "string?", ownerActorName: "string?", ownerUserId: "string?", ownerUserName: "string?", simpleAction: "boolean?" }, async run(a) {
    const tg = findTarget(a); if (tg.error) return tg.error;
    const owner = (a.ownerActorId || a.ownerActorName)
      ? findActor({ actorId: a.ownerActorId, actorName: a.ownerActorName }) : null;
    if ((a.ownerActorId || a.ownerActorName) && !owner) return fail(404, "owner actor not found");
    const ownerUser = (a.ownerUserId && game.users.get(a.ownerUserId))
      || (a.ownerUserName && game.users.find(u => u.name?.toLowerCase() === String(a.ownerUserName).toLowerCase()))
      || null;
    const data = petFlagData({
      ownerId: ownerUser?.id || a.ownerUserId || null,
      ownerName: ownerUser?.name || owner?.name || a.ownerUserName || a.ownerActorName || null,
      ownerActorId: owner?.id || a.ownerActorId || null,
      simpleAction: a.simpleAction !== false
    });
    await tg.actor.update({ "flags.ai-gm-bridge.pet": data });
    return ok({ actorId: tg.actor.id, name: tg.actor.name, pet: data });
  } },
  listPets: { schema: {}, async run() { return ok({ pets: listPetsFrom(game.actors, { readPet: readPetFlag }) }); } },
  placePets: { schema: { sceneId: "string?" }, async run(a) {
    const scene = a.sceneId ? game.scenes.get(a.sceneId) : currentScene();
    const placed = await placePetsOnScene(scene);
    if (placed?.error) return fail(404, placed.error);
    return ok({ placed });
  } },
  start: { schema: {}, async run() {
    const via = sessionApi("startGame");
    if (via) return via;
    if (game.paused) game.togglePause?.(false, { broadcast: true });
    try { await game.settings.set(MODULE_ID, "aiPaused", false); } catch {}
    return ok({ paused: false, aiPaused: false, control: "start" });
  } },
  pause: { schema: {}, async run() {
    const via = sessionApi("pauseGame");
    if (via) return via;
    try { await game.settings.set(MODULE_ID, "aiPaused", true); } catch {}
    if (!game.paused) game.togglePause?.(true, { broadcast: true });
    return ok({ paused: true, aiPaused: true, control: "pause" });
  } },
  rollTable: { schema: { tableId: "string?", tableName: "string?", displayChat: "boolean?" }, async run(a) {
    const table = game.tables?.get?.(a.tableId) ?? game.tables?.getName?.(a.tableName);
    if (!table) return fail(404, "roll table not found");
    const draw = await table.draw({ displayChat: a.displayChat !== false });
    const results = [...(draw?.results ?? [])].map(r => ({ text: r.text, name: r.name, type: r.type, documentId: r.documentId, documentUuid: r.documentUuid }));
    return ok({ tableId: table.id, table: table.name, ...summarizeDraw(results, table.name), results });
  } },
  giveLoot: { schema: { tableId: "string?", tableName: "string?", ...TARGET }, async run(a) {
    const table = game.tables?.get?.(a.tableId) ?? game.tables?.getName?.(a.tableName);
    if (!table) return fail(404, "roll table not found");
    const refs = normalizeTargetArgs(a);
    let actor = null;
    if (refs.hasExplicit) {
      const tg = findTarget({
        tokenId: refs.tokenIds[0], tokenName: refs.tokenNames[0],
        actorId: refs.actorIds[0], actorName: refs.actorNames[0], sceneId: refs.sceneId
      });
      if (tg.error) return tg.error; actor = tg.actor;
    } else {
      actor = (globalThis.canvas?.tokens?.controlled ?? [])[0]?.actor ?? null;
    }
    if (!actor) return fail(400, "select a token or pass actor/token");
    const draw = await table.draw({ displayChat: true });
    const planned = planLoot([...(draw?.results ?? [])]);
    const added = [];
    for (const it of planned.items) {
      let item = null;
      try { if (it.uuid && globalThis.fromUuid) item = await fromUuid(it.uuid); } catch {}
      if (!item && it.id) item = game.items?.get?.(it.id) ?? null;
      if (item?.toObject) { await actor.createEmbeddedDocuments("Item", [item.toObject()]); added.push(item.name); }
    }
    return ok({ actorId: actor.id, name: actor.name, added, texts: planned.texts, table: table.name });
  } },
  applyDamage: { schema: { amount: "number", ...TARGET }, async run(a) {
    const planned = planDamage([{ id: "x", hp: { value: 1 } }], a.amount);
    if (planned.error) return fail(400, planned.error);
    const refs = normalizeTargetArgs(a);
    const targets = [];
    const seen = new Set();
    const addActor = (actor, name) => {
      if (!actor || seen.has(actor.id)) return;
      seen.add(actor.id);
      targets.push({ id: actor.id, name: name || actor.name, actor, hp: readActorHp(actor) });
    };
    const addFrom = (args) => {
      const tg = findTarget(args);
      if (!tg.error) addActor(tg.actor, tg.actor?.name);
    };
    if (refs.hasExplicit) {
      for (const id of refs.tokenIds) addFrom({ tokenId: id, sceneId: refs.sceneId });
      for (const name of refs.tokenNames) addFrom({ tokenName: name, sceneId: refs.sceneId });
      for (const id of refs.actorIds) addFrom({ actorId: id, sceneId: refs.sceneId });
      for (const name of refs.actorNames) addFrom({ actorName: name, sceneId: refs.sceneId });
    } else {
      for (const tok of (globalThis.canvas?.tokens?.controlled ?? [])) {
        if (tok?.actor) addActor(tok.actor, tok.name);
      }
    }
    if (!targets.length) return fail(400, "select tokens or pass tokenId/tokenName/tokenIds/actorId/actorName/actorIds");
    const next = planDamage(targets, a.amount);
    const updated = [];
    for (const u of next.updates) {
      const t = targets.find(x => x.id === u.id);
      if (!t?.actor || u.after == null) continue;
      if (t.actor.updateHp) await t.actor.updateHp({ value: u.after });
      else await t.actor.update({ "system.attributes.hp.value": u.after });
      updated.push(u);
    }
    return ok({ amount: next.amount, updated });
  } },
  startShipCombat: { schema: { tokenIds: "array?" }, async run(a) {
    const scene = currentScene();
    const tokens = sceneTokens(scene);
    const selected = a.tokenIds ?? (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.id);
    const planned = planShipFight({ tokens, selectedIds: selected, combat: game.combat });
    if (planned.error) return fail(400, planned.error);
    let combat = game.combat;
    if (!combat && globalThis.Combat?.create) combat = await Combat.create({ scene: scene?.id });
    if (combat) {
      const existing = new Set([...(combat.combatants?.contents ?? combat.combatants ?? [])].map(c => c.tokenId));
      const add = planned.addTokenIds.filter(id => !existing.has(id)).map(tokenId => ({ tokenId, sceneId: scene?.id }));
      if (add.length) await combat.createEmbeddedDocuments?.("Combatant", add);
      if (!combat.started && combat.startCombat) await combat.startCombat();
      crewTracker.sync(combat);
    }
    const ships = planned.ships.map(s => ({ name: s.name, hp: s.hp, crew: s.crew, hull: s.hull, tokenId: s.tokenId, actorId: s.actorId, crewActionsThisRound: crewTracker.count(s.actorId) }));
    try { Hooks.callAll(`${MODULE_ID}.shipCombat`, { ships, combatId: combat?.id ?? null }); } catch {}
    return ok({ combatId: combat?.id ?? null, ships });
  } },
  shipStatus: { schema: {}, async run() {
    const ships = collectShips(sceneTokens(currentScene())).map(s => ({ ...s, crewActionsThisRound: crewTracker.count(s.actorId) }));
    return ok({ ships, tracker: crewTracker.snapshot() });
  } },
  setupCheck: { schema: {}, async run() {
    return ok(liveSetupCheck({ scene: globalThis.canvas?.scene ?? game.scenes?.viewed ?? game.scenes?.active, combat: game.combat, users: game.users?.contents ?? [] }));
  } },
  recap: { schema: { since: "any?", max: "number?" }, async run(a) { return ok(await F.recap(a)); } },
  rest: { schema: { actorId: "string?", actorName: "string?", ...TOK, length: "string?", kind: "string?", food: "string?", infected: "boolean?" }, async run(a) {
    const tg = findTarget(a); if (tg.error) return fail("NOT_FOUND", tg.error.error); return F.rest(tg.actor, { ...a, length: a.length ?? a.kind }); } },
  speakBubble: { schema: { tokenId: "string?", tokenName: "string?", sceneId: "string?", text: "string", emote: "boolean?" }, async run(a) {
    const t = findToken(a); if (!t) return fail("NOT_FOUND", "token not found"); return F.speakBubble({ tokenId: t.id, text: unwrapText(a.text), emote: a.emote }); } },
  post: { schema: { content: "string", replyTo: "string?", speakerAlias: "string?", allowMultiple: "boolean?", ackEventIds: "array?" }, async run(a, ctx) { a = withReplyTo(a, ctx); if ("content" in a) a.content = unwrapText(a.content);
    const prev = priorReply(ctx.dedupe, a.replyTo, a.allowMultiple === true);
    if (prev) { await ackAfter(ctx, a.ackEventIds); return ok({ messageId: prev, duplicate: true }); }
    const m = await ChatMessage.create({ content: a.content, speaker: a.speakerAlias ? { alias: a.speakerAlias } : ChatMessage.getSpeaker(),
      flags: { "ai-gm-bridge": { replyTo: a.replyTo ?? null } } });
    recordReply(ctx.dedupe, a.replyTo, m.id, Date.now()); await ctx.persistNow(); await ackAfter(ctx, a.ackEventIds);
    return ok({ messageId: m.id });
  }},
};

export async function runCommand(cmd, ctx) {
  try {
    if (!cmd || typeof cmd !== "object") return fail(400, "command must be an object");
    const def = COMMANDS[cmd.name]; if (!def) return fail(404, `unknown command: ${cmd.name}`);
    const args = cmd.args ?? {};
    const err = validate(def.schema, args); if (err) return fail(400, err);
    const res = await def.run(args, ctx);
    return res ?? fail(500, "handler returned nothing");
  } catch (e) { return fail(500, e?.message ?? e); }
}
