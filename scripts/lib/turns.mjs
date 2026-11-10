// Combat turn prompts (pure). Zero wakes: built and posted locally.
export function combatExpect(combat) {
  if (!combat?.id) return null;
  return { combatId: combat.id, round: combat.round ?? 0, turn: combat.turn ?? 0 };
}
// Player-owned actors are PCs; missing actor counts as an NPC so a monster turn cannot stall the fight.
export function combatantIsNpc(combatant) {
  const actor = combatant?.actor;
  if (!actor) return true;
  return !actor.hasPlayerOwner;
}
export function shouldWakeOnTurn(combat, turnWake) {
  if (!turnWake) return false;
  return combatantIsNpc(combat?.combatant);
}
// Worlds that never stored turnWake pick up the new default (on). A stored false stays off.
export function resolveTurnWake(stored) {
  if (!stored?.present) return true;
  return !!stored.value;
}
export function readStoredFlag(storage, key) {
  if (!storage) return { present: false, value: undefined };
  let raw;
  try { raw = storage.get?.(key); } catch { raw = undefined; }
  if (raw && typeof raw === "object" && "value" in raw && (raw.key === key || raw.id === key)) raw = raw.value;
  if (raw === undefined && typeof storage.find === "function") {
    const doc = storage.find(s => s?.key === key || s?.id === key);
    if (doc && typeof doc === "object" && "value" in doc) raw = doc.value;
  }
  if (raw === undefined) return { present: false, value: undefined };
  if (raw === true || raw === "true") return { present: true, value: true };
  if (raw === false || raw === "false") return { present: true, value: false };
  return { present: true, value: !!raw };
}
export function turnInfo(combat, users = []) {
  if (!combat?.started || !combat.combatant) return null;
  const cb = combat.combatant; const actor = cb.actor;
  const owners = users.filter(u => !u.isGM && u.active !== false && (actor?.testUserPermission?.(u, "OWNER") || (cb.players ?? []).some(p => p.id === u.id)));
  const next = combat.turns?.[(combat.turn + 1) % (combat.turns?.length || 1)];
  return { combatId: combat.id, round: combat.round, turn: combat.turn, name: cb.name, isNPC: !owners.length, ownerIds: owners.map(u => u.id), ownerNames: owners.map(u => u.name), next: next?.name ?? null, expect: combatExpect(combat) };
}
export function turnText(t) {
  if (!t) return "No active combat.";
  return `Round ${t.round}: ${t.name} is up${t.ownerNames.length ? ` (${t.ownerNames.join(", ")})` : ""}.${t.next && t.next !== t.name ? ` Next: ${t.next}.` : ""}`;
}
export const voiceUsersFrom = (csv) => String(csv ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
