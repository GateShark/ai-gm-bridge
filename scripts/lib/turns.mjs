import { readPetFlag } from "./pets.mjs";
import { isShip } from "./ship.mjs";
// Combat turn prompts (pure). Zero wakes: built and posted locally.
export function combatExpect(combat) {
  if (!combat?.id) return null;
  return { combatId: combat.id, round: combat.round ?? 0, turn: combat.turn ?? 0 };
}
export function combatantActor(combatant) {
  return combatant?.actor ?? combatant?.token?.actor ?? null;
}
export function combatantOwners(combatant, users = []) {
  const actor = combatantActor(combatant);
  const tokenActor = combatant?.token?.actor;
  const out = []; const seen = new Set();
  const add = (u) => { if (!u?.id || seen.has(u.id)) return; seen.add(u.id); out.push(u); };
  for (const p of combatant?.players ?? []) add(p);
  for (const u of users) {
    if (!u || u.active === false || u.isGM) continue;
    if (actor?.testUserPermission?.(u, "OWNER") || tokenActor?.testUserPermission?.(u, "OWNER")) add(u);
    else if (u.character && actor && (u.character === actor || u.character.id === actor.id)) add(u);
  }
  return out;
}
// Same rule for turn events and turnStatus: Foundry's combatant.isNPC, then hasPlayerOwner /
// character type / listed players (unlinked token actors often fail testUserPermission).
export function combatantIsNpc(combatant, users = []) {
  if (!combatant) return true;
  if (typeof combatant.isNPC === "boolean") return combatant.isNPC;
  const actor = combatantActor(combatant);
  const token = combatant.token;
  if (actor?.hasPlayerOwner || token?.hasPlayerOwner || combatant.hasPlayerOwner) return false;
  if ((combatant.players ?? []).length) return false;
  if (actor?.type === "character") return false;
  if (combatantOwners(combatant, users).length) return false;
  return true;
}
export function shouldWakeOnTurn(combat, turnWake, users = []) {
  if (!turnWake) return false;
  return combatantIsNpc(combat?.combatant, users);
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
  const cb = combat.combatant;
  const owners = combatantOwners(cb, users);
  const next = combat.turns?.[(combat.turn + 1) % (combat.turns?.length || 1)];
  const info = { combatId: combat.id, round: combat.round, turn: combat.turn, name: cb.name, isNPC: combatantIsNpc(cb, users), ownerIds: owners.map(u => u.id), ownerNames: owners.map(u => u.name), next: next?.name ?? null, expect: combatExpect(combat) };
  const actor = combatantActor(cb);
  const pet = readPetFlag(actor);
  if (pet) {
    info.isPet = true;
    info.simpleAction = pet.simpleAction !== false;
    if (pet.ownerName || pet.ownerId || pet.ownerActorId) info.petOwner = pet.ownerName || pet.ownerId || pet.ownerActorId;
  }
  if (isShip(actor)) info.isShip = true;
  return info;
}
export function turnText(t) {
  if (!t) return "No active combat.";
  let extra = t.ownerNames.length ? ` (${t.ownerNames.join(", ")})` : "";
  if (t.isPet) {
    const who = t.petOwner ? `pet of ${t.petOwner}` : "pet";
    extra += t.simpleAction !== false ? ` — ${who}, one simple action` : ` — ${who}`;
  }
  return `Round ${t.round}: ${t.name} is up${extra}.${t.next && t.next !== t.name ? ` Next: ${t.next}.` : ""}`;
}
export const voiceUsersFrom = (csv) => String(csv ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
