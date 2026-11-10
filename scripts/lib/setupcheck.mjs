// Pre-game / combat-start owner check: character-type or classed pirates with no
// non-GM owner would be treated as monsters. Warn only — never change the world.
import { combatantOwners } from "./turns.mjs";
import { sceneTokens } from "./gmpanel.mjs";

function itemsOf(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return [...items]; } catch { return []; }
}
export function looksLikePlayerPirate(actor) {
  if (!actor) return false;
  if (actor.type === "character") return true;
  return itemsOf(actor).some(i => i && i.type === "class");
}
export function subjectFromToken(t) {
  if (!t) return null;
  const actor = t.actor ?? (t.system ? t : null);
  if (!actor && !t.name) return null;
  return { name: t.name || actor?.name, actor: actor ?? t, token: t.actor ? t : (t.system ? null : t), tokenId: t.id ?? null, actorId: actor?.id ?? t.id ?? null };
}
export function subjectFromCombatant(cb) {
  if (!cb) return null;
  const actor = cb.actor ?? cb.token?.actor ?? null;
  return { name: cb.name ?? actor?.name, actor, token: cb.token ?? null, players: cb.players, combatant: cb,
    tokenId: cb.tokenId ?? cb.token?.id ?? null, actorId: actor?.id ?? cb.actorId ?? null };
}
export function hasNonGmOwner(subject, users = []) {
  const actor = subject?.actor;
  const token = subject?.token;
  if (actor?.hasPlayerOwner || token?.hasPlayerOwner || subject?.combatant?.hasPlayerOwner) return true;
  const players = subject?.players ?? subject?.combatant?.players ?? [];
  if (players.some(p => p && !p.isGM)) return true;
  return combatantOwners({ actor, token, players }, users).length > 0;
}
export function findUnownedPirates(subjects, users = []) {
  const out = [];
  for (const s of subjects ?? []) {
    if (!s?.name) continue;
    if (!looksLikePlayerPirate(s.actor)) continue;
    if (hasNonGmOwner(s, users)) continue;
    out.push({ name: s.name, actorId: s.actorId ?? null, tokenId: s.tokenId ?? null });
  }
  return out;
}
export function formatOwnerWarning(unowned) {
  if (!unowned?.length) return null;
  const names = unowned.map(u => u.name).filter(Boolean).join(", ");
  const tail = "Assign a non-GM owner before play. Nothing was changed.";
  if (unowned.length === 1) return `${names} looks like a player pirate but has no player owner and will be treated as a monster. ${tail}`;
  return `${unowned.length} pirates have no player owner and will be treated as monsters: ${names}. ${tail}`;
}
function uniqueUnowned(list) {
  const seen = new Set(); const out = [];
  for (const u of list) {
    const k = `${u.tokenId ?? ""}:${u.actorId ?? ""}:${u.name}`;
    if (seen.has(k)) continue; seen.add(k); out.push(u);
  }
  return out;
}
export function runSetupCheck({ tokens = [], combatants = [], users = [], scene = null } = {}) {
  const subjects = [...(combatants ?? []).map(subjectFromCombatant), ...(tokens ?? []).map(subjectFromToken)].filter(Boolean);
  const unowned = uniqueUnowned(findUnownedPirates(subjects, users));
  const warning = formatOwnerWarning(unowned);
  return { ok: !unowned.length, scene: scene ?? null, checked: subjects.length, unowned, warning,
    text: warning || "All player-looking pirates here have a player owner." };
}
export function combatantsOf(combat) {
  const raw = combat?.combatants;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (Array.isArray(raw.contents)) return raw.contents.filter(Boolean);
  try { return [...raw].filter(Boolean); } catch { return []; }
}
export function liveSetupCheck({ scene, combat, users = [], tokens } = {}) {
  return runSetupCheck({
    tokens: tokens ?? sceneTokens(scene),
    combatants: combatantsOf(combat),
    users,
    scene: scene?.name ?? (typeof scene === "string" ? scene : null)
  });
}
export function formatConnectionWithSetup(conn = {}, setup = null) {
  const base = conn.ok ? (conn.message || "OK") : (conn.error || "Failed");
  const extra = setup?.warning || setup?.text;
  return extra ? `${base} — ${extra}` : base;
}
