// 0.9.0 #5: unpause after a map build or combat start/turn during play. Never on world load; setting autoUnpause (default on).
export const AUTO_UNPAUSE_REASONS = ["mapBuild", "combatStart", "combatTurn", "testFight"];
export function shouldAutoUnpause({ enabled = true, paused = false, aiPaused = false, ready = true, isGM = true, reason = null } = {}) {
  if (!paused || enabled === false || aiPaused || !ready || !isGM) return false;
  if (reason === "worldLoad" || reason === "ready") return false;
  return AUTO_UNPAUSE_REASONS.includes(reason);
}
const settingOr = (g, key, d) => { try { const v = g?.settings?.get?.("ai-gm-bridge", key); return v ?? d; } catch { return d; } };
export function autoUnpause(reason, g = globalThis.game) {
  const ok = shouldAutoUnpause({ enabled: settingOr(g, "autoUnpause", true) !== false, paused: !!g?.paused, aiPaused: !!settingOr(g, "aiPaused", false),
    ready: g?.ready !== false, isGM: !!g?.user?.isGM, reason });
  if (!ok) return { unpaused: false, reason };
  try { g.togglePause(false, { broadcast: true }); } catch (e) { return { unpaused: false, reason, error: String(e?.message ?? e) }; }
  return { unpaused: true, reason };
}
