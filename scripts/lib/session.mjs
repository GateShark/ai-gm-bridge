// 0.8.15: compact "where we left off" snapshot. Notes are stored for the GM/bot
// but never appear in the spoiler-free recap text (Foundry still syncs world
// settings to every client — same limit as other world data).
import { recapStamp } from "./sessionlog.mjs";
import { readActorHp } from "./hp.mjs";

export const MAX_SESSION_ACTORS = 24;
export const MAX_SESSION_ITEMS = 8;
export const MAX_SESSION_NOTES = 2000;
export const SKIP_ITEM_TYPES = new Set(["class", "feature", "background", "ability"]);

function itemList(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return [...items]; } catch { return []; }
}

export function keyItemNames(actor, { limit = MAX_SESSION_ITEMS } = {}) {
  const out = [];
  const cap = Math.max(0, Number(limit) || 0);
  for (const i of itemList(actor)) {
    if (!i?.name || SKIP_ITEM_TYPES.has(i.type)) continue;
    out.push(String(i.name));
    if (out.length >= cap) break;
  }
  return out;
}

export function collectSessionSnapshot({
  scene = null, combat = null, tokens = [], notes = "", now = Date.now(),
  readHp = readActorHp, readPet = null
} = {}) {
  const actors = [];
  for (const tok of tokens ?? []) {
    if (actors.length >= MAX_SESSION_ACTORS) break;
    const actor = tok?.actor ?? (tok?.system ? tok : null);
    if (!actor) continue;
    const hp = readHp?.(actor);
    const items = keyItemNames(actor);
    const pet = typeof readPet === "function" ? readPet(actor) : null;
    const row = {
      id: actor.id ?? tok.id ?? null,
      name: tok.name || actor.name || "Unknown",
      tokenId: tok.id ?? null,
      hp: hp && (hp.value != null || hp.max != null) ? { value: hp.value ?? null, max: hp.max ?? null } : null,
      pc: !!(actor.hasPlayerOwner ?? tok.hasPlayerOwner)
    };
    if (items.length) row.items = items;
    if (pet) row.pet = pet;
    actors.push(row);
  }
  return {
    savedAt: now,
    scene: scene ? { id: scene.id ?? null, name: scene.name ?? null } : null,
    combat: combat?.started ? {
      id: combat.id ?? null,
      round: combat.round ?? 0,
      turn: combat.turn ?? 0,
      who: combat.combatant?.name ?? null
    } : null,
    actors,
    notes: String(notes ?? "").slice(0, MAX_SESSION_NOTES)
  };
}

export function formatSessionRecap(snap, { now = Date.now() } = {}) {
  if (!snap || !Number(snap.savedAt)) return "No session snapshot saved yet.";
  const when = recapStamp(snap.savedAt, now);
  const scene = snap.scene?.name || "an unknown scene";
  const combat = snap.combat?.who
    ? ` Combat was in progress (round ${snap.combat.round}, ${snap.combat.who} was up).`
    : " No active combat.";
  const people = (snap.actors ?? []).map(a => {
    const hp = a.hp && (a.hp.value != null || a.hp.max != null)
      ? ` ${a.hp.value ?? "?"}${a.hp.max != null ? `/${a.hp.max}` : ""} HP`
      : "";
    return `${a.name}${hp}`;
  });
  const who = people.length ? ` ${people.join("; ")}.` : "";
  return `Where we left off (${when}): the crew is on ${scene}.${combat}${who}`;
}

export function applySessionHpPlan(snap) {
  return (snap?.actors ?? [])
    .filter(a => a.id && a.hp && typeof a.hp.value === "number")
    .map(a => ({ actorId: a.id, name: a.name, value: a.hp.value }));
}
