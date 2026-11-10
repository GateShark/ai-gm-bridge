// 0.8.3: immediate combat start/end events so a bot can stay awake during fights. Pure; Foundry docs are passed in.
import { combatantActor, combatantIsNpc, combatantOwners } from "./turns.mjs";
import { readActorHp } from "./hp.mjs";
import { combatantsOf, runSetupCheck } from "./setupcheck.mjs";
import { shipRosterFields } from "./shiptrack.mjs";

export { combatantsOf };
export function combatRoster(combat, users = []) {
  const out = [];
  for (const cb of combatantsOf(combat)) {
    const actor = combatantActor(cb);
    const name = cb?.name ?? actor?.name ?? null;
    if (!name) continue;
    const hp = readActorHp(actor);
    const owners = combatantOwners(cb, users);
    const row = { name, isNPC: combatantIsNpc(cb, users) };
    if (hp && (hp.value != null || hp.max != null)) { row.hp = hp.value ?? null; row.max = hp.max ?? null; }
    if (owners[0]?.name) row.owner = owners[0].name;
    const ship = shipRosterFields(actor);
    if (ship) Object.assign(row, ship);
    out.push(row);
  }
  return out;
}
export function combatEvent(c, state, { users = [] } = {}) {
  if (!c?.id || (state !== "start" && state !== "end")) return null;
  const list = combatantsOf(c);
  const ev = { eventId: `combat:${c.id}:${state}`, type: "combat", state, combatId: c.id,
    sceneId: c.scene?.id ?? c.sceneId ?? (typeof c.scene === "string" ? c.scene : null), round: c.round ?? 0,
    combatants: list.map(x => x?.name ?? x?.actor?.name ?? null).filter(Boolean) };
  if (state === "start") {
    ev.roster = combatRoster(c, users);
    const check = runSetupCheck({ combatants: list, users });
    if (check.warning) { ev.ownerWarning = check.warning; ev.unownedPirates = check.unowned.map(u => u.name); }
  }
  return ev;
}
// updateCombat: did this change start the combat? (started flips true when round goes 0 -> 1). Revisiting
// round 1 later is harmless: the start eventId is deduped per combat.
export const startedNow = (c, change) => !!c?.started && Number(change?.round) === 1;
