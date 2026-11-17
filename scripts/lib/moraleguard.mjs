// 0.9.2: a moralePrompt is only useful while its combat is still running and an enemy is still alive.
// A sweep that kills every enemy and then ends the combat must not send a late prompt (or roll morale for nobody).
import { livingEnemies } from "./morale.mjs";

// Returns a reason string when the prompt is stale, else null. Prompts without a combatId (manual) are never stale.
export function moraleStale(prompt, g = globalThis.game) {
  const id = prompt?.combatId;
  if (!id || !g) return null;
  const combat = g.combats?.get?.(id) ?? (g.combat?.id === id ? g.combat : null);
  if (!combat || combat.started === false) return "combatEnded";
  const users = g.users?.contents ?? g.users ?? [];
  let alive = 1;
  try { alive = livingEnemies(combat, users).length; } catch { return null; }
  return alive > 0 ? null : "noEnemiesLeft";
}
