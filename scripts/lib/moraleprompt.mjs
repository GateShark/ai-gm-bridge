// Optional wake when the first enemy dies or half the enemies are down.
// Emits an event only — it never rolls morale itself.
import { hpDroppedToZero } from "./pcdown.mjs";
import { hostileCombatants } from "./morale.mjs";
import { readActorHp } from "./hp.mjs";

export function buildMoralePrompt(combat, hostiles, st) {
  const down = hostiles.filter(h => h.hp != null && Number(h.hp) <= 0).length;
  const total = hostiles.length;
  if (!total) return null;
  const reasons = [];
  if (down >= 1 && !st.first) reasons.push("firstEnemyDown");
  if (down >= Math.ceil(total / 2) && !st.half) reasons.push("halfDown");
  if (!reasons.length) return null;
  if (reasons.includes("firstEnemyDown")) st.first = true;
  if (reasons.includes("halfDown")) st.half = true;
  return {
    eventId: `moraleprompt:${combat.id}:${reasons.join("+")}`,
    type: "moralePrompt",
    reason: reasons[0],
    reasons,
    combatId: combat.id,
    round: combat.round ?? 0,
    down,
    total,
    enemies: hostiles.map(h => ({ name: h.name, actorId: h.actorId ?? h.actor?.id ?? null, tokenId: h.tokenId, hp: h.hp, max: h.max }))
  };
}

// 0.8.20 #4: unlinked tokens of one actor share actor.id, so track HP per token.
export const trackId = (actor) => actor?.token?.id ? `tok:${actor.token.id}` : (actor?.id ?? actor?.name ?? null);
export function createMoralePromptTracker() {
  const last = new Map();
  const flags = new Map();
  return {
    reset(combatId) {
      if (combatId) flags.delete(combatId);
      else flags.clear();
      last.clear();
    },
    seed(actor) {
      const id = trackId(actor);
      if (!id) return;
      const hp = readActorHp(actor);
      if (!last.has(id)) last.set(id, hp?.value);
    },
    observe(actor, { combat, users = [], enabled = true } = {}) {
      if (!enabled || !combat?.id || !combat.started || !actor) return null;
      const id = trackId(actor);
      if (!id) return null;
      const hp = readActorHp(actor);
      const first = !last.has(id);
      // A token never seen before (spawned after the last seed) that is now at 0 was alive a moment ago.
      const unseenKill = first && Number(hp?.value) <= 0 && Number(hp?.max) > 0;
      const prev = unseenKill ? hp.max : (first ? hp?.value : last.get(id));
      last.set(id, hp?.value);
      if (first && !unseenKill) return null;
      const hostiles = hostileCombatants(combat, users);
      const tokId = actor.token?.id ?? null;
      if (!hostiles.some(h => tokId ? h.tokenId === tokId : (h.actor === actor || h.actorId === actor.id))) return null;
      if (!hpDroppedToZero(prev, hp?.value)) return null;
      let st = flags.get(combat.id);
      if (!st) { st = { first: false, half: false }; flags.set(combat.id, st); }
      return buildMoralePrompt(combat, hostiles, st);
    }
  };
}
