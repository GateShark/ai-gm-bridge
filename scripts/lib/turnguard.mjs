// 0.9.2: turn guard. nextTurn waits for (or rejects on) an open requestRoll tied to the combat, and the
// turn/"is up" prompts are held while a roll from an earlier turn is still open.
// A roll blocks only while it is genuinely open: status "pending" and not past its own timeoutAt.
// "timeout" (the GM was already told), "expired", "cancelled" and "done" never block, so nothing waits forever.
export const ROLL_WAIT_MS = 15000;       // nextTurn: how long to wait for an open roll before rejecting
export const ROLL_WAIT_MAX_MS = 60000;   // ceiling for the optional waitMs argument
export const PROMPT_HOLD_MS = 20000;     // turn prompt: longest hold before it fires anyway
export const POLL_MS = 250;

const isLive = (r, now) => r?.status === "pending" && !(r.timeoutAt && now >= r.timeoutAt) && !(r.expireAt && now >= r.expireAt);

// pending: rolls from pendingRequests(). combatId: the combat being advanced. actorIds: its combatants' actors, so a roll
// that carries no combatId but is for one of them still counts. mode "advance" (nextTurn): any open roll in the combat.
// mode "prompt": only rolls from an EARLIER turn (round/turn differ from the current one); rolls asked on this turn
// belong to this turn and must not hold its own prompt.
export function blockingRolls(pending, { combatId, round, turn, actorIds = [], now = Date.now(), mode = "advance" } = {}) {
  const ids = new Set((actorIds ?? []).filter(Boolean));
  return (pending ?? []).filter((r) => {
    if (!isLive(r, now)) return false;
    const tied = r.combatId ? r.combatId === combatId : (ids.size > 0 && ids.has(r.actorId));
    if (!tied) return false;
    if (mode === "prompt") return r.round != null && r.turn != null && (r.round !== round || r.turn !== turn);
    return true;
  });
}
export const describeBlockers = (list) => (list ?? []).map((r) => ({ requestId: r.id, actor: r.actorName ?? null, user: r.userName ?? null, label: r.label || r.formula || r.stat || null, ...(r.dr != null ? { dr: r.dr } : {}), ...(r.timeoutAt ? { timeoutAt: r.timeoutAt } : {}) }));
export const clampWait = (ms, dflt = ROLL_WAIT_MS) => { const n = Number(ms); return Number.isFinite(n) ? Math.min(ROLL_WAIT_MAX_MS, Math.max(0, n)) : dflt; };

// Poll until check() returns an empty list, ms runs out, or stop() says the wait no longer matters.
// Resolves { blockers, waited, aborted }.
export async function waitUntilClear(check, { ms = ROLL_WAIT_MS, step = POLL_MS, stop = () => false, sleep = (t) => new Promise(r => setTimeout(r, t)) } = {}) {
  const t0 = Date.now();
  let blockers = []; try { blockers = check() ?? []; } catch { blockers = []; }
  let waited = false;
  while (blockers.length) {
    if (stop()) return { blockers, waited, aborted: true };
    const left = ms - (Date.now() - t0);
    if (left <= 0) return { blockers, waited, aborted: false };
    waited = true;
    await sleep(Math.min(step, left));
    try { blockers = check() ?? []; } catch { blockers = []; }
  }
  return { blockers: [], waited, aborted: false };
}
