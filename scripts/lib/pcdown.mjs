// Fire once when a player-owned character's HP drops from above 0 to 0 or below.
// Re-arms when HP goes back above 0. HP is read from system.attributes.hp.
import { readActorHp } from "./hp.mjs";
import { combatantOwners } from "./turns.mjs";

export function isPlayerOwnedActor(actor, users = [], token = null) {
  if (!actor) return false;
  if (actor.hasPlayerOwner || token?.hasPlayerOwner) return true;
  return combatantOwners({ actor, token }, users).length > 0;
}
export function hpDroppedToZero(prev, next) {
  const a = Number(prev), b = Number(next);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b <= 0;
}
export function buildPcDownEvent({ actor, token, hp, combat, now = Date.now(), seq = 0 } = {}) {
  const tokenId = token?.id ?? actor?.token?.id ?? null;
  const ev = {
    eventId: `pcdown:${actor?.id ?? actor?.name}:${now}${seq ? `:${seq}` : ""}`,
    type: "pcDown",
    actor: actor?.name ?? null,
    actorId: actor?.id ?? null,
    tokenId,
    hp: { value: Number(hp?.value), max: hp?.max ?? null }
  };
  if (combat?.id) { ev.combatId = combat.id; ev.round = combat.round ?? 0; ev.turn = combat.turn ?? 0; }
  return ev;
}
export function createDownTracker() {
  const last = new Map(); const down = new Set(); let seq = 0;
  return {
    observe(actor, { users = [], token = null, combat = null, now = Date.now() } = {}) {
      const id = actor?.id ?? actor?.name;
      if (!id) return null;
      const hp = readActorHp(actor);
      const next = hp?.value;
      const first = !last.has(id);
      const prev = first ? next : last.get(id);
      last.set(id, next);
      const nextN = Number(next);
      if (Number.isFinite(nextN) && nextN > 0) { down.delete(id); return null; }
      if (first) { if (Number.isFinite(nextN) && nextN <= 0) down.add(id); return null; }
      if (down.has(id)) return null;
      if (!isPlayerOwnedActor(actor, users, token)) return null;
      if (!hpDroppedToZero(prev, next)) return null;
      down.add(id);
      return buildPcDownEvent({ actor, token, hp, combat, now, seq: ++seq });
    },
    reset() { last.clear(); down.clear(); seq = 0; }
  };
}
