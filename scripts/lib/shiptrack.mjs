// 0.8.15: read-only tracking of Pirate Borg ships (vehicle / vehicle_npc).
// Mirrors the official system's own fields — we never write new system.* keys.
// Public system (Limithron pirate-borg): Ship/Vehicle sheet, crew actions
// (broadsides, small arms, ram, repair, full sail, come about, anchors, shanty,
// sink), hull-as-armor tier, crew/cargo/shanties, captain + crew actor links.
import { isShip, shipSummary } from "./ship.mjs";

export function collectShips(tokens = [], hullDie) {
  const out = [];
  for (const tok of tokens ?? []) {
    const actor = tok?.actor ?? (isShip(tok) ? tok : null);
    if (!isShip(actor)) continue;
    const s = shipSummary(actor, hullDie);
    out.push({ ...s, tokenId: tok.id ?? null, name: tok.name || s.name });
  }
  return out;
}

export function shipRosterFields(actor) {
  if (!isShip(actor)) return null;
  const s = shipSummary(actor);
  return { kind: "ship", crew: s.crew?.value ?? null, crewMax: s.crew?.max ?? null, hull: s.hull ?? null };
}

export function createCrewTracker() {
  let combatId = null, round = 0;
  const used = new Map();
  return {
    sync(combat) {
      const id = combat?.id ?? null;
      const r = Number(combat?.round) || 0;
      if (id !== combatId || r !== round) { combatId = id; round = r; used.clear(); }
      return { combatId, round };
    },
    record(shipId) {
      if (!shipId) return 0;
      const n = (used.get(shipId) || 0) + 1;
      used.set(shipId, n);
      return n;
    },
    count(shipId) { return used.get(shipId) || 0; },
    snapshot() {
      return { combatId, round, actions: [...used.entries()].map(([shipId, count]) => ({ shipId, count })) };
    }
  };
}

export const crewTracker = createCrewTracker();

export function planShipFight({ tokens = [], selectedIds = null, combat = null } = {}) {
  const ships = collectShips(tokens);
  const ids = (selectedIds ?? []).filter(Boolean);
  let chosen = ships;
  if (ids.length) {
    const set = new Set(ids);
    const filtered = ships.filter(s => set.has(s.tokenId) || set.has(s.actorId));
    if (filtered.length) chosen = filtered;
  }
  if (!chosen.length) return { error: "no ships on this scene" };
  return {
    ships: chosen,
    combatId: combat?.id ?? null,
    startCombat: !combat?.started,
    addTokenIds: chosen.map(s => s.tokenId).filter(Boolean)
  };
}
