// Pirate Borg resource adapter (system pirateborg v1.9.0 template.json). Actor sheets are the single source of truth.
// character: attributes.hp{value,max}, luck{value} (Devil's Luck), rituals{value,max} (arcane rituals),
//            extraResource{value,max} (class-specific pool, e.g. prayers — label comes from the class item).
// creature: attributes.hp; vehicle/vehicle_npc: attributes.hp, hull, crew, cargo, shanties.
export const RESOURCE_PATHS = {
  character: { hp: "system.attributes.hp", luck: "system.attributes.luck", devilsLuck: "system.attributes.luck",
               rituals: "system.attributes.rituals", extraResource: "system.attributes.extraResource" },
  creature: { hp: "system.attributes.hp" },
  vehicle: { hp: "system.attributes.hp", hull: "system.attributes.hull", crew: "system.attributes.crew", cargo: "system.attributes.cargo", shanties: "system.attributes.shanties" },
};
RESOURCE_PATHS.vehicle_npc = RESOURCE_PATHS.vehicle;

// extraResourceLabel: class's own name for its extra pool (e.g. "Prayers"), if any.
export function resolveResource(actorType, name, extraResourceLabel = "") {
  const map = RESOURCE_PATHS[actorType]; if (!map) return { error: `unsupported actor type ${actorType}` };
  const n = String(name).toLowerCase().replace(/[^a-z]/g, "");
  const key = Object.keys(map).find(k => k.toLowerCase() === n);
  if (key) return { key, base: map[key] };
  const label = String(extraResourceLabel).toLowerCase().replace(/[^a-z]/g, "");
  if (map.extraResource && label && (label === n || label.replace(/s$/, "") === n.replace(/s$/, "")))
    return { key: "extraResource", base: map.extraResource, label: extraResourceLabel };
  if (n.startsWith("prayer")) return { error: label ? `this actor's extra resource is "${extraResourceLabel}", not prayers` : "this actor has no prayers pool (no class extra resource); rituals are a separate pool" };
  return { error: `unknown resource ${name}; available: ${Object.keys(map).join(", ")}${label ? ", " + extraResourceLabel : ""}` };
}
// Compute the new value: absolute `value` or relative `delta`, clamped to [min, max] when present.
export function nextValue(cur, { value, delta }) {
  const v = cur?.value ?? 0; let n = value !== undefined ? value : v + (delta ?? 0);
  if (typeof cur?.min === "number") n = Math.max(cur.min, n);
  if (typeof cur?.max === "number" && cur.max > 0) n = Math.min(cur.max, n);
  return n;
}
export function summarize(actorType, system, extraResourceLabel = "") {
  const map = RESOURCE_PATHS[actorType] ?? {}; const out = {};
  for (const [k, p] of Object.entries(map)) {
    if (k === "devilsLuck") continue;
    const v = p.replace(/^system\./, "").split(".").reduce((o, s) => o?.[s], system);
    if (v !== undefined) out[k === "extraResource" && extraResourceLabel ? extraResourceLabel : k] = { value: v.value, max: v.max };
  }
  return out;
}
// v0.6.1: amounts for setHP/setResource. value or delta, as numbers or strings; "+3"/"-2" in value means a delta.
export function parseAmount({ value, delta } = {}) {
  if ((value === undefined || value === null || value === "") === (delta === undefined || delta === null || delta === "")) return { error: "give exactly one of value or delta" };
  const raw = value ?? delta; const str = String(raw).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(str)) return { error: `not a number: ${raw}` };
  const n = Number(str);
  if (delta !== undefined && delta !== null && delta !== "") return { delta: n };
  return typeof value === "string" && /^[+-]/.test(str) ? { delta: n } : { value: n };
}
