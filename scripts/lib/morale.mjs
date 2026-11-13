// Enemy morale helpers. The official pirateborg creature field is system.attributes.morale
// (template.json creature.attributes.morale; "-" / empty means the creature never breaks).
import { parseMorale } from "./ship.mjs";
import { combatantActor, combatantIsNpc } from "./turns.mjs";
import { combatantsOf } from "./setupcheck.mjs";
import { readActorHp } from "./hp.mjs";
import { readPetFlag } from "./pets.mjs";

export const CREATURE_MORALE_PATH = "system.attributes.morale";

export function moraleIsUnbreakable(v) {
  return parseMorale(v) === null;
}

export function readCreatureMorale(actor, override) {
  const hasOverride = override !== undefined && override !== null && String(override).trim() !== "";
  const raw = hasOverride ? override : actor?.system?.attributes?.morale;
  const morale = parseMorale(raw);
  return { raw: raw ?? null, morale, unbreakable: morale === null };
}

export function combatantRow(cb) {
  const actor = combatantActor(cb);
  const hp = readActorHp(actor);
  return {
    combatant: cb,
    actor,
    name: cb?.name ?? actor?.name ?? null,
    actorId: actor?.id ?? null,
    tokenId: cb?.tokenId ?? cb?.token?.id ?? null,
    hp: hp?.value ?? null,
    max: hp?.max ?? null
  };
}

// 0.8.20 #4: who is an enemy of the PCs. Token disposition alone never makes a combatant an enemy (allies were
// left HOSTILE by accident). Order: explicit side flag (flags.ai-gm-bridge.side = "ally"|"enemy" on the token or
// actor) > PC (player-owned) > pet > character-type NPC (crew/hireling) > FRIENDLY token > enemy.
export const FRIENDLY = 1;
function flagSide(doc) {
  const v = doc?.getFlag?.("ai-gm-bridge", "side") ?? doc?.flags?.["ai-gm-bridge"]?.side;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "ally" || s === "enemy" ? s : null;
}
export function combatantSide(cb, users = []) {
  if (!cb) return "enemy";
  const actor = combatantActor(cb);
  const tokenDoc = cb.token?.document ?? cb.token ?? null;
  const flagged = flagSide(tokenDoc) ?? flagSide(actor) ?? flagSide(cb);
  if (flagged) return flagged;
  if (!combatantIsNpc(cb, users)) return "pc";
  if (readPetFlag(actor)) return "ally";
  if (actor?.type === "character") return "ally";
  const disp = tokenDoc?.disposition ?? cb.token?.disposition;
  if (Number(disp) === FRIENDLY) return "ally";
  return "enemy";
}
const rowKey = (r) => r.tokenId || r.combatant?.id || r.actorId || r.name;
// One row per combatant token: unlinked copies of the same actor are separate creatures.
export function enemyCombatants(combat, users = []) {
  const seen = new Set(); const out = [];
  for (const cb of combatantsOf(combat)) {
    if (combatantSide(cb, users) !== "enemy") continue;
    const row = combatantRow(cb); row.isNPC = true; row.side = "enemy";
    const k = rowKey(row); if (seen.has(k)) continue; seen.add(k); out.push(row);
  }
  return out;
}
const isDown = (h) => (h.hp != null && Number(h.hp) <= 0) || h.combatant?.isDefeated === true || h.combatant?.defeated === true;
export function livingEnemies(combat, users = []) {
  return enemyCombatants(combat, users).filter(h => !isDown(h));
}
// Kept for callers/tests from 0.8.19: "hostile" now means an enemy of the PCs (allies are excluded).
export function hostileCombatants(combat, users = []) { return enemyCombatants(combat, users); }
export function livingHostiles(combat, users = []) { return livingEnemies(combat, users); }

export function pcCombatants(combat, users = []) {
  return combatantsOf(combat).filter(cb => !combatantIsNpc(cb, users)).map(cb => {
    const row = combatantRow(cb);
    row.isNPC = false;
    return row;
  });
}

export function combatEndSides(combat, users = []) {
  const defeated = hostileCombatants(combat, users)
    .filter(h => h.hp != null && Number(h.hp) <= 0)
    .map(({ combatant, actor, ...row }) => row);
  const pcs = pcCombatants(combat, users).map(({ combatant, actor, ...row }) => row);
  return { defeated, pcs };
}
