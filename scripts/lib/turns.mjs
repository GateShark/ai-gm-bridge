// Combat turn prompts (pure). Zero wakes: built and posted locally.
export function turnInfo(combat, users = []) {
  if (!combat?.started || !combat.combatant) return null;
  const cb = combat.combatant; const actor = cb.actor;
  const owners = users.filter(u => !u.isGM && u.active !== false && (actor?.testUserPermission?.(u, "OWNER") || (cb.players ?? []).some(p => p.id === u.id)));
  const next = combat.turns?.[(combat.turn + 1) % (combat.turns?.length || 1)];
  return { combatId: combat.id, round: combat.round, turn: combat.turn, name: cb.name, isNPC: !owners.length, ownerIds: owners.map(u => u.id), ownerNames: owners.map(u => u.name), next: next?.name ?? null };
}
export function turnText(t) {
  if (!t) return "No active combat.";
  return `Round ${t.round}: ${t.name} is up${t.ownerNames.length ? ` (${t.ownerNames.join(", ")})` : ""}.${t.next && t.next !== t.name ? ` Next: ${t.next}.` : ""}`;
}
export const voiceUsersFrom = (csv) => String(csv ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
