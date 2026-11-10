// Enemy morale helpers. The official pirateborg creature field is system.attributes.morale
// (template.json creature.attributes.morale; "-" / empty means the creature never breaks).
import { parseMorale } from "./ship.mjs";
import { combatantActor, combatantIsNpc } from "./turns.mjs";
import { combatantsOf } from "./setupcheck.mjs";
import { readActorHp } from "./hp.mjs";

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

export function hostileCombatants(combat, users = []) {
  return combatantsOf(combat).filter(cb => combatantIsNpc(cb, users)).map(cb => {
    const row = combatantRow(cb);
    row.isNPC = true;
    return row;
  });
}

export function livingHostiles(combat, users = []) {
  return hostileCombatants(combat, users).filter(h => h.hp == null || Number(h.hp) > 0);
}

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
