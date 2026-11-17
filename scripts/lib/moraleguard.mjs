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

// 0.9.5: a sweep (applyDamage on several creatures) writes the tokens one at a time, so the first death used to start a morale
// run while the others still looked alive. The sweep marks itself here; an automatic morale run waits until it has settled
// (the sweep finished and a short quiet time passed), then looks at the real state again.
export const SWEEP_SETTLE_MS = 600, SWEEP_CAP_MS = 8000;
const sweep = { n: 0, last: 0 };
export const beginSweep = () => { sweep.n++; };
export const endSweep = (now = Date.now()) => { sweep.n = Math.max(0, sweep.n - 1); sweep.last = now; };
export const sweepActive = (now = Date.now(), settleMs = SWEEP_SETTLE_MS) => sweep.n > 0 || (sweep.last > 0 && now - sweep.last < settleMs);
export async function waitSweepSettled({ settleMs = SWEEP_SETTLE_MS, capMs = SWEEP_CAP_MS, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const t0 = now();
  while (sweepActive(now(), settleMs) && now() - t0 < capMs) await sleep(100);
}
export const resetSweep = () => { sweep.n = 0; sweep.last = 0; };
