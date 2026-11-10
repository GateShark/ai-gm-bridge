// v0.6 runtime features: requestRoll, turn prompts, session log, Pirate Borg rest, speakBubble.
// Deps are injected by main.mjs via initFeatures() so commands.mjs and tests can use them.
import { ok, fail } from "./lib/result.mjs";
import { normStat, formulaFor, normalizeFormula, evaluate, evaluateFormula, reqFormula, canClick, reqIdFrom, cardHtml, matchRoll, naturalOf, d20Of, rollBreakdown, rollsOf, isOpen } from "./lib/rollreq.mjs";
import { turnInfo, turnText, voiceUsersFrom, turnVoiceUserIds } from "./lib/turns.mjs";
import { resolveReplyTo, priorRollReply, recordRollReply } from "./lib/replies.mjs";
import { actorChanges, lineHtml, parseLines, recap as recapLines, TRACKED, stamp } from "./lib/sessionlog.mjs";
import { planRest, clampHp, diffReport, canRestoreResource } from "./lib/pbrest.mjs";
import { createDownTracker } from "./lib/pcdown.mjs";
import { sceneTokens } from "./lib/gmpanel.mjs";
import { pickAudioSrc, localVoiceSlug, playLocalVoice } from "./lib/voices.mjs";
import { createMoralePromptTracker } from "./lib/moraleprompt.mjs";

const ID = "ai-gm-bridge"; const SOCKET = `module.${ID}`;
const D = { emit: () => {}, get: () => undefined, voice: () => null, turnClip: () => null, turnAudio: () => ({}), amLeader: () => true, log: () => {} };
export function initFeatures(deps) { Object.assign(D, deps); }
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").trim();
const findUser = (u) => game.users.get(u) ?? game.users.find(x => x.name?.toLowerCase() === String(u ?? "").toLowerCase()) ?? null;

// ---------- requestRoll ----------
const timers = new Map();
const reqMessages = () => game.messages.contents.slice(-300).filter(m => m.flags?.[ID]?.rollRequest);
export const pendingRequests = () => reqMessages().map(m => ({ ...m.flags[ID].rollRequest, messageId: m.id })).filter(r => r.status !== "done" && r.status !== "expired" && r.status !== "cancelled");
function sameRollTarget(a, b) {
  if (!a || !b) return false;
  return a.userId === b.userId && a.actorId === b.actorId
    && String(a.label || "") === String(b.label || "")
    && String(a.formula || a.stat || "") === String(b.formula || b.stat || "");
}
export function existingOpenRequest(pending, target) {
  return (pending ?? []).find(r => sameRollTarget(r, target)) ?? null;
}
export async function requestRoll(a) {
  const id = reqIdFrom(a.requestId, foundry.utils.randomID()); // idempotent: same requestId returns the existing card/result
  const prior = reqMessages().find(m => m.flags[ID].rollRequest.id === id);
  if (prior) { const r = prior.flags[ID].rollRequest; return ok({ requestId: id, messageId: prior.id, status: r.status, result: r.result ?? null, duplicate: true }); }
  const replyTo = resolveReplyTo(a.replyTo);
  if (replyTo) {
    const locked = priorRollReply(D.dedupe, replyTo);
    if (locked && (locked.s === "acked" || locked.s === "sent")) {
      const hit = reqMessages().find(m => m.flags[ID].rollRequest.id === locked.requestId) ?? reqMessages().find(m => m.id === locked.messageId);
      if (hit) {
        const r = hit.flags[ID].rollRequest;
        return ok({ requestId: r.id, messageId: hit.id, status: r.status, result: r.result ?? null, duplicate: true, ...(r.timeoutAt ? { timeoutAt: r.timeoutAt } : {}), ...(r.combatId ? { combatId: r.combatId } : {}) });
      }
    }
  }
  let formula = typeof a.formula === "string" && a.formula.trim() ? normalizeFormula(a.formula) : null;
  let rawStat = typeof a.stat === "string" ? a.stat.trim() : "";
  if (!formula && rawStat && /^\d*d\d/i.test(rawStat)) { formula = normalizeFormula(rawStat); rawStat = ""; }
  const stat = rawStat ? normStat(rawStat) : null;
  if (!formula && !stat) return fail("BAD_STAT", `unknown stat ${a.stat}; use strength, agility, presence, toughness or spirit, or pass formula`);
  if (formula && rawStat && !stat) return fail("BAD_STAT", `unknown stat ${a.stat}`);
  if (!formula && typeof a.dr !== "number") return fail("BAD_ARGS", "dr is required for a stat test");
  if (formula && globalThis.Roll?.validate && !Roll.validate(formula)) return fail("BAD_FORMULA", `invalid formula ${formula}`);
  const user = findUser(a.user); if (!user) return fail("NOT_FOUND", `user ${a.user} not found`);
  const actor = (a.actorId && game.actors.get(a.actorId)) || (a.actorName && game.actors.getName(a.actorName)) || user.character;
  if (!actor) return fail("NOT_FOUND", "no actor (pass actorId/actorName or give the user a character)");
  const twin = existingOpenRequest(pendingRequests(), { userId: user.id, actorId: actor.id, formula, stat, label: a.label ?? "" });
  if (twin) return ok({ requestId: twin.id, messageId: twin.messageId, status: twin.status, result: twin.result ?? null, duplicate: true, ...(twin.timeoutAt ? { timeoutAt: twin.timeoutAt } : {}), ...(twin.combatId ? { combatId: twin.combatId } : {}) });
  const timeoutMs = Math.max(5000, a.timeoutMs ?? D.get("rollRequestTimeoutMs") ?? 120000);
  const combatId = a.combatId || game.combat?.id || null;
  const req = { id, userId: user.id, userName: user.name, actorId: actor.id, actorName: actor.name, stat, ...(formula ? { formula } : {}), dr: a.dr ?? null, label: a.label ?? "", status: "pending", at: Date.now(), timeoutAt: Date.now() + timeoutMs,
    expireAt: Date.now() + timeoutMs + Math.max(0, a.expireAfterMs ?? D.get("rollRequestExpireMs") ?? 600000), ...(combatId ? { combatId } : {}) };
  const msg = await ChatMessage.create({ content: cardHtml(req), speaker: { alias: D.get("speakerAlias") || "AI GM" }, flags: { [ID]: { local: true, rollRequest: req } } });
  armTimeout(req, msg.id);
  if (replyTo) recordRollReply(D.dedupe, replyTo, id, msg.id, Date.now());
  return ok({ requestId: id, messageId: msg.id, status: "pending", timeoutAt: req.timeoutAt, ...(combatId ? { combatId } : {}) });
}
// pending -> (timeoutAt) timeout: GM fallback button + rollTimeout event -> (expireAt) expired: no longer answerable.
function armTimeout(req, messageId) {
  clearTimeout(timers.get(req.id)); if (req.status !== "pending" && req.status !== "timeout") return;
  const due = req.status === "pending" ? req.timeoutAt : (req.expireAt ?? Infinity); if (!isFinite(due)) return;
  timers.set(req.id, setTimeout(async () => {
    const m = game.messages.get(messageId); const r = m?.flags?.[ID]?.rollRequest; if (!r || !D.amLeader() || (r.status !== "pending" && r.status !== "timeout")) return;
    const next = { ...r, status: r.status === "pending" ? "timeout" : "expired" };
    await m.update({ content: cardHtml(next), [`flags.${ID}.rollRequest`]: next });
    if (next.status === "timeout") { D.emit({ eventId: `rollreq:${r.id}:timeout`, type: "rollTimeout", requestId: r.id, actor: r.actorName, user: r.userName }, { urgent: false }); armTimeout(next, messageId); }
  }, Math.max(0, due - Date.now())));
}
export function rearmRollRequests() { for (const r of pendingRequests()) armTimeout(r, r.messageId); }
// Leader: a new chat message may answer a pending request. Returns true when consumed (no normal chat event).
export async function onRollMessage(msg) {
  if (!rollsOf(msg).length) return false;
  const req = matchRoll(msg, pendingRequests()); if (!req) return false;
  const by = msg.author ?? msg.user; if (!canClick(req, typeof by === "string" ? game.users.get(by) : by)) return false;
  const roll = req.formula ? (rollsOf(msg)[0]?.roll ?? d20Of(msg)) : d20Of(msg);
  const result = req.formula ? evaluateFormula({ total: roll.total, natural: naturalOf(roll), dr: req.dr }) : evaluate({ total: roll.total, natural: naturalOf(roll), dr: req.dr });
  const bd = rollBreakdown(roll); if (bd) Object.assign(result, { breakdown: bd.text, dice: bd.dice, modifier: bd.modifier }); // v0.8.6
  const via = msg.flags?.[ID]?.rollRequestId ? "button" : msg.flags?.pirateborg?.outcomes ? "sheet roll" : "roll";
  const done = { ...req, status: "done", result, rollMessageId: msg.id, answeredBy: `${via} by ${(typeof by === "object" ? by?.name : game.users.get(by)?.name) ?? "?"}` }; delete done.messageId;
  clearTimeout(timers.get(req.id));
  const card = game.messages.get(req.messageId); if (card) await card.update({ content: cardHtml(done), [`flags.${ID}.rollRequest`]: done });
  if (D.get("rollAnswerNote") !== false) await ChatMessage.create({ content: `<small>↳ answers ${req.label || req.formula || req.stat}${req.dr != null ? ` DR ${req.dr}` : ""} for ${req.actorName}: ${result.breakdown ?? result.total}${result.success === null ? "" : result.success ? " success" : " fail"}</small>`,
    speaker: { alias: D.get("speakerAlias") || "AI GM" }, flags: { [ID]: { local: true, rollAnswer: req.id } } });
  D.emit({ eventId: `rollreq:${req.id}`, type: "rollResult", requestId: req.id, actor: req.actorName, user: req.userName, by: (typeof by === "object" ? by?.name : game.users.get(by)?.name) ?? null,
    via, stat: req.stat, ...(req.formula ? { formula: req.formula, label: req.label || null } : {}), dr: req.dr, ...result, success: result.success === true, crit: result.crit === true, fumble: result.fumble === true, ...(req.formula && result.success === null ? { success: null } : {}) }, { urgent: true });
  return true;
}
// Any client: wire the card button.
export function findCancellableRequests(requestId, extra = {}) {
  const msgs = reqMessages();
  const id = requestId || extra.requestId || extra.messageId;
  const hits = [];
  if (id) {
    for (const m of msgs) {
      const r = m.flags[ID].rollRequest;
      if (r.id === id || m.id === id) hits.push(m);
    }
  }
  if (!hits.length) {
    const { actorId, actorName, label, user } = extra;
    if (actorId || actorName || label || user) {
      for (const m of msgs) {
        const r = m.flags[ID].rollRequest;
        if (actorId && r.actorId !== actorId) continue;
        if (actorName && String(r.actorName || "").toLowerCase() !== String(actorName).toLowerCase()) continue;
        if (label && String(r.label || "").toLowerCase() !== String(label).toLowerCase()) continue;
        if (user && r.userId !== user && String(r.userName || "").toLowerCase() !== String(user).toLowerCase()) continue;
        hits.push(m);
      }
    }
  }
  if (!hits.length) return [];
  const seen = new Set(hits.map(m => m.id));
  const out = [...hits];
  for (const seed of hits) {
    const r = seed.flags[ID].rollRequest;
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      if (sameRollTarget(m.flags[ID].rollRequest, r)) { seen.add(m.id); out.push(m); }
    }
  }
  return out;
}
export async function cancelRollRequest(requestId, extra = {}) {
  const opts = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  const list = findCancellableRequests(requestId, opts);
  if (!list.length) return fail("NOT_FOUND", `roll request ${requestId || opts.messageId || opts.label || ""} not found`);
  const cancelled = [];
  let primary = null;
  let noop = null;
  for (const m of list) {
    const r = m.flags[ID].rollRequest;
    if (r.status === "done" || r.status === "expired" || r.status === "cancelled") {
      noop ??= { requestId: r.id, messageId: m.id, status: r.status, noop: true };
      continue;
    }
    const next = { ...r, status: "cancelled" };
    clearTimeout(timers.get(r.id));
    await m.update({ content: cardHtml(next), [`flags.${ID}.rollRequest`]: next });
    D.emit({ eventId: `rollreq:${r.id}:cancel`, type: "rollCancelled", requestId: r.id, actor: r.actorName, user: r.userName }, { urgent: false });
    cancelled.push({ requestId: r.id, messageId: m.id });
    primary ??= { requestId: r.id, messageId: m.id, status: "cancelled" };
  }
  if (!primary) return ok({ ...(noop ?? { requestId, status: "cancelled", noop: true }), cancelled: [] });
  return ok({ ...primary, cancelled });
}
export function rollsTiedToCombat(pending, combatId) {
  if (!combatId) return [];
  return (pending ?? []).filter(r => r && r.combatId === combatId);
}
export async function cancelCombatRolls(combat) {
  const cancelled = [];
  for (const r of rollsTiedToCombat(pendingRequests(), combat?.id)) {
    const res = await cancelRollRequest(r.id);
    if (res.ok) cancelled.push(r.id);
  }
  return cancelled;
}
export function bindRollCard(msg, html) {
  const req = msg.flags?.[ID]?.rollRequest; if (!req || req.status === "done" || req.status === "cancelled" || req.status === "expired") return;
  const root = html?.[0] ?? html; const btns = root?.querySelectorAll?.(`[data-aigm-roll]`); if (!btns?.length) return;
  for (const btn of btns) {
    if (!canClick(req, game.user) || (btn.dataset.gmOnly && !game.user.isGM)) { btn.disabled = true; continue; }
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault(); btn.disabled = true;
      const actor = game.actors.get(req.actorId); if (!actor) return ui.notifications?.warn("Actor not found");
      const roll = await new Roll(reqFormula(req), actor.getRollData()).evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${req.label || req.formula || req.stat}${req.dr != null ? ` (DR ${req.dr})` : ""}`, flags: { [ID]: { rollRequestId: req.id, rollStat: req.stat } } });
    });
  }
}

// ---------- combat turn prompts (zero wakes) ----------
const lastPrompt = new Map();
export function turnStatus(combat = game.combat) { return turnInfo(combat, game.users.contents); }
export async function turnPrompt(combat) {
  const t = turnStatus(combat); if (!t) return null;
  const key = `${t.round}.${t.turn}`; if (lastPrompt.get(combat.id) === key) return null; lastPrompt.set(combat.id, key);
  await ChatMessage.create({ content: turnText(t), speaker: { alias: D.get("speakerAlias") || "AI GM" }, flags: { [ID]: { local: true, turnPrompt: key } } });
  if (!t.ownerIds.length) return t;
  const spoken = t.name ? `Your turn: ${t.name}.` : "Your turn.";
  const audio = D.turnAudio(t.name) || {};
  const clip = audio.ryan || D.voice(spoken) || null;
  const ping = { type: "turnPing", userIds: t.ownerIds, text: `Your turn: ${t.name}`, spoken, clip, audio,
    voiceUserIds: turnVoiceUserIds(t.ownerIds, {
      voiceTurnPrompt: D.get("voiceTurnPrompt") !== false,
      turnVoiceUsers: D.get("turnVoiceUsers"),
      users: game.users?.contents ?? game.users ?? []
    }) };
  game.socket.emit(SOCKET, ping); onTurnPing(ping);
  return t;
}
export function onTurnPing(p) {
  if (!p.userIds?.includes(game.user.id)) return;
  ui.notifications?.info(p.text);
  if (!p.voiceUserIds?.includes(game.user.id)) return;
  const src = pickAudioSrc(p.audio, localVoiceSlug(), p.clip);
  if (src) playLocalVoice(src, { text: p.spoken || p.text });
}

// ---------- session log ----------
export const LOG_NAME = "AI GM Session Log";
const snap = new Map(); let buf = []; let flushT = null; const started = new Set();
const downs = createDownTracker();
const moralePrompts = createMoralePromptTracker();
const pick = (a) => { const o = {}; for (const p of Object.values(TRACKED)) foundry.utils.setProperty(o, p, foundry.utils.getProperty(a, p)); const hp = D.get("hpPath"); if (hp) foundry.utils.setProperty(o, hp, foundry.utils.getProperty(a, hp)); return o; };
export function seedSnapshots() {
  downs.reset();
  moralePrompts.reset();
  for (const a of game.actors) { snap.set(a.id, pick(a)); downs.observe(a); moralePrompts.seed(a); }
  try {
    const scene = globalThis.canvas?.scene ?? game.scenes?.viewed;
    for (const tok of sceneTokens(scene)) if (tok?.actor) { downs.observe(tok.actor, { token: tok }); moralePrompts.seed(tok.actor); }
  } catch {}
}
export function logLine(kind, text, at = Date.now()) { if (!D.get("sessionLog")) return; buf.push(lineHtml(at, kind, text)); clearTimeout(flushT); flushT = setTimeout(flushLog, 4000); }
export function onActorUpdate(actor, change) {
  const g = typeof globalThis.game === "object" ? globalThis.game : null;
  const users = g?.users?.contents ?? g?.users ?? [];
  const combat = g?.combat?.started ? g.combat : null;
  const ev = downs.observe(actor, { users, token: actor?.token ?? null, combat });
  if (ev) D.emit(ev, { urgent: true });
  const prompt = moralePrompts.observe(actor, { users, combat, enabled: D.get("moralePrompts") !== false });
  if (prompt) D.emit(prompt, { urgent: true });
  const before = snap.get(actor.id); snap.set(actor.id, pick(actor)); if (!before) return;
  const hpPath = foundry.utils.getProperty(actor, "system.attributes.hp") ? undefined : D.get("hpPath");
  for (const c of actorChanges(actor.name, before, pick(actor), { extraLabel: actor.extraResourceNamePlural || "", hpPath })) logLine(c.kind, c.text);
}
export function onItemCreate(item) { const a = item.parent; if (a?.documentName === "Actor" && item.type !== "class") logLine("item", `${a.name} gained ${item.name}`); }
export function onCombatUpdate(c, change) {
  if (change.round === 1 && !started.has(c.id)) { started.add(c.id); logLine("combat", `Combat started (${c.combatants.map(x => x.name).join(", ")})`); }
}
export function onCombatDelete(c) { if (c?.id) { lastPrompt.delete(c.id); moralePrompts.reset(c.id); } if (c.started || c.round > 0) logLine("combat", `Combat ended after round ${c.round}`); }
async function logJournal() {
  let j = game.journal.getName(LOG_NAME);
  if (!j) j = await JournalEntry.create({ name: LOG_NAME, ownership: { default: 0 } });
  return j;
}
export async function flushLog() {
  if (!buf.length || !D.amLeader()) return; const lines = buf.join(""); buf = [];
  const j = await logJournal(); const day = stamp(Date.now()).slice(0, 10);
  const page = j.pages.getName(day);
  if (page) await page.update({ "text.content": (page.text?.content ?? "") + lines });
  else await j.createEmbeddedDocuments("JournalEntryPage", [{ name: day, type: "text", text: { content: lines, format: 1 } }]);
}
export async function recap({ since, max } = {}) {
  await flushLog();
  const j = game.journal.getName(LOG_NAME); if (!j) return recapLines([], { since, max });
  return recapLines(j.pages.contents.flatMap(p => parseLines(p.text?.content)), { since, max });
}

// ---------- Pirate Borg rest ----------
const sysPath = (p) => (foundry.utils.getRoute?.(`systems/pirateborg/module/${p}`) ?? `/systems/pirateborg/module/${p}`);
async function sys(p) { try { return await import(sysPath(p)); } catch { return null; } }
const vals = (a) => { const s = a.system?.attributes ?? {}; const o = { hp: s.hp?.value, "Devil's Luck": s.luck?.value, rituals: s.rituals?.value };
  if (a.useExtraResource) o[a.extraResourceNamePlural || "extraResource"] = s.extraResource?.value; return o; };
export async function rest(actor, args = {}) {
  if (game.system.id !== "pirateborg") return fail("UNSUPPORTED", "rest needs the pirateborg system");
  if (actor.type !== "character") return fail("BAD_ACTOR", "rest is for characters");
  const plan = planRest(args); if (plan.error) return fail("BAD_ARGS", plan.error);
  const before = vals(actor); const rolls = []; const used = [];
  const c = "api/action/character/";
  const [AR, AE, AL] = await Promise.all([sys(c + "character-rituals-per-day-action.js"), sys(c + "character-extra-resource-per-day-action.js"), sys(c + "character-luck-per-day-action.js")]);
  const A = { ...AR, ...AE, ...AL }; const G = await sys(c + "character-drink-grog-action.js"); const SS = await sys("system/settings.js");
  const grog = (() => { try { return SS?.isGrogEnabled?.() ?? false; } catch { return false; } })();
  const hpDelta = async (formula, sign, why) => {
    const r = await new Roll(formula).evaluate(); rolls.push(`${why} ${formula}=${r.total}`);
    const hp = actor.system.attributes.hp; await actor.update({ "system.attributes.hp.value": clampHp(hp.value + sign * r.total, hp.max) });
  };
  for (const s of plan.steps) {
    if (s.step === "heal") await hpDelta(s.formula, 1, "heal");
    else if (s.step === "damage") await hpDelta(s.formula, -1, s.why);
    else if (s.step === "grogHours" && grog && G?.decrementGrogHours) { await G.decrementGrogHours(actor, 1); used.push("decrementGrogHours"); }
    else if (s.step === "clearGrog" && grog && G?.clearGrogEffects) { await G.clearGrogEffects(actor); used.push("clearGrogEffects"); }
    else if (s.step === "rituals" && canRestoreResource(actor, "rituals")) {
      if (A?.characterRitualsPerDayAction) { const o = await A.characterRitualsPerDayAction(actor, { silent: true }); used.push("characterRitualsPerDayAction"); if (o?.roll) rolls.push(`rituals ${o.formula ?? ""}=${o.roll.total}`); }
      else { const r = await new Roll("max(d4 + @abilities.spirit.value, 0)", actor.getRollData()).evaluate(); await actor.update({ "system.attributes.rituals.value": r.total, "system.attributes.rituals.max": r.total }); }
    } else if (s.step === "extraResource" && canRestoreResource(actor, "extraResource")) {
      if (A?.characterExtraResourcePerDayAction) { const o = await A.characterExtraResourcePerDayAction(actor, { silent: true }); used.push("characterExtraResourcePerDayAction"); if (o?.roll) rolls.push(`${actor.extraResourceNamePlural || "extra"} ${o.formula ?? ""}=${o.roll.total}`); }
      else { const r = await new Roll(`max(${actor.extraResourceFormula}, 0)`, actor.getRollData()).evaluate(); await actor.update({ "system.attributes.extraResource.value": r.total, "system.attributes.extraResource.max": r.total }); }
    } else if (s.step === "luckIfZero" && (actor.system.attributes.luck?.value ?? 0) === 0 && actor.luckDie) {
      if (A?.characterLuckPerDayAction) { const o = await A.characterLuckPerDayAction(actor, { silent: true }); used.push("characterLuckPerDayAction"); if (o?.roll) rolls.push(`luck ${o.formula ?? ""}=${o.roll.total}`); }
      else { const r = await new Roll(actor.luckDie, actor.getRollData()).evaluate(); await actor.update({ "system.attributes.luck.value": r.total }); }
    }
  }
  const after = vals(actor); const report = diffReport(before, after) + (rolls.length ? ` [${rolls.join("; ")}]` : "");
  await ChatMessage.create({ content: `<b>${actor.name}</b> — ${plan.length} rest${plan.food !== "eat" ? ` (${plan.food})` : ""}${plan.infected ? " (infected)" : ""}: ${report}`,
    speaker: { alias: D.get("speakerAlias") || "AI GM" }, flags: { [ID]: { local: true } } });
  logLine("rest", `${actor.name} ${plan.length} rest: ${report}`);
  return ok({ actor: actor.name, length: plan.length, food: plan.food, infected: plan.infected, before, after, report, rolls, systemFunctions: used });
}

// ---------- speakBubble ----------
export function showBubble({ tokenId, text, emote }) {
  const t = canvas?.tokens?.get?.(tokenId); if (!t || !canvas.hud?.bubbles) return false;
  canvas.hud.bubbles.say(t, text, { emote: !!emote, pan: false }); return true;
}
export function speakBubble({ tokenId, text, emote }) {
  const clean = strip(text).slice(0, 300); if (!clean) return fail("BAD_ARGS", "text is empty");
  const p = { type: "bubble", tokenId, text: clean, emote: !!emote };
  game.socket.emit(SOCKET, p); const shown = showBubble(p);
  return ok({ tokenId, text: clean, broadcast: true, shownHere: shown });
}
