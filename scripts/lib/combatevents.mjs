// 0.8.3: immediate combat start/end events so a bot can stay awake during fights. Pure; Foundry docs are passed in.
export function combatEvent(c, state) {
  if (!c?.id || (state !== "start" && state !== "end")) return null;
  const list = c.combatants?.contents ?? (Array.isArray(c.combatants) ? c.combatants : [...(c.combatants ?? [])]);
  return { eventId: `combat:${c.id}:${state}`, type: "combat", state, combatId: c.id,
    sceneId: c.scene?.id ?? c.sceneId ?? (typeof c.scene === "string" ? c.scene : null), round: c.round ?? 0,
    combatants: list.map(x => x?.name ?? x?.actor?.name ?? null).filter(Boolean) };
}
// updateCombat: did this change start the combat? (started flips true when round goes 0 -> 1). Revisiting
// round 1 later is harmless: the start eventId is deduped per combat.
export const startedNow = (c, change) => !!c?.started && Number(change?.round) === 1;
