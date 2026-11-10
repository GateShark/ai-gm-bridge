// HP reads: Pirate Borg stores the live values at system.attributes.hp.
// Older worlds (and some sheets) also have a stale system.hp {value:0} that must not win.
const get = (o, p) => String(p ?? "").split(".").reduce((x, k) => x?.[k], o);
function pick(obj) {
  if (obj && typeof obj === "object" && "value" in obj) return { value: obj.value ?? null, max: obj.max ?? null };
  return null;
}
export const DEFAULT_HP_PATH = "system.attributes.hp.value";
export const LEGACY_HP_PATH = "system.hp.value";
export function migratedHpPath(path) {
  return path === LEGACY_HP_PATH ? DEFAULT_HP_PATH : path;
}
export function readActorHp(actor, hpPath) {
  const known = pick(actor?.system?.attributes?.hp) || pick(actor?.system?.hp);
  if (known) return known;
  const p = hpPath || DEFAULT_HP_PATH;
  const value = get(actor, p);
  const max = get(actor, p.replace(/\.value$/, ".max"));
  return (value == null && max == null) ? null : { value: value ?? null, max: max ?? null };
}
