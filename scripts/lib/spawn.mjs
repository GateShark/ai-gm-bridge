// spawnAndVision + token lock helpers (pure). Clamp inputs; build v13/v14 token data with sight/light.
const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : d;
const COLOR = /^#[0-9a-f]{6}$/i;
export const VISION_MODES = ["basic", "darkvision", "monochromatic", "tremorsense", "lightAmplification"];
export function sightData(v) {
  if (!v) return undefined;
  const o = { enabled: v.enabled !== false };
  if (v.range !== undefined) o.range = num(v.range, 0, 1000, 0);
  if (v.angle !== undefined) o.angle = num(v.angle, 1, 360, 360);
  if (v.visionMode !== undefined) { if (!VISION_MODES.includes(v.visionMode)) return { error: `visionMode must be one of ${VISION_MODES.join(", ")}` }; o.visionMode = v.visionMode; }
  return o;
}
export function lightData(l) {
  if (!l) return undefined;
  const o = { dim: num(l.dim, 0, 1000, 0), bright: num(l.bright, 0, 1000, 0) };
  if (o.bright > o.dim) o.dim = o.bright;
  if (l.angle !== undefined) o.angle = num(l.angle, 1, 360, 360);
  if (l.alpha !== undefined) o.alpha = num(l.alpha, 0, 1, 0.5);
  if (l.color !== undefined) { if (l.color !== null && !COLOR.test(l.color)) return { error: "light.color must be #rrggbb" }; o.color = l.color; }
  if (l.animation) o.animation = { type: typeof l.animation.type === "string" ? l.animation.type : null, speed: num(l.animation.speed, 0, 10, 5), intensity: num(l.animation.intensity, 1, 10, 5) };
  return o;
}
// -> {error} | token data overrides (merged onto the actor prototype token by Foundry)
export function buildSpawn(a, { flagScope = "ai-gm-bridge" } = {}) {
  if (!(typeof a.x === "number" && typeof a.y === "number")) return { error: "x and y required" };
  const sight = sightData(a.vision); if (sight?.error) return sight;
  const light = lightData(a.light); if (light?.error) return light;
  const d = { x: Math.round(a.x), y: Math.round(a.y) };
  if (a.name) d.name = String(a.name).slice(0, 80);
  if (a.hidden !== undefined) d.hidden = !!a.hidden;
  if (a.elevation !== undefined) d.elevation = num(a.elevation, -10000, 10000, 0);
  if (a.disposition !== undefined) d.disposition = num(a.disposition, -2, 1, 0);
  if (sight) d.sight = sight; if (light) d.light = light;
  if (a.locked) d.locked = true;
  d.flags = { [flagScope]: { spawnKey: a.spawnKey ?? null, lock: a.locked ? (a.lockScope ?? "move") : null } };
  return d;
}
// Token lock policy: should this update (by this user) be blocked?
export const LOCK_SCOPES = ["move", "all"];
export function lockBlocks(lock, change, isGM) {
  if (!lock || isGM) return false;
  if (lock === "all") return true;
  return ["x", "y", "elevation", "rotation"].some(k => k in (change ?? {}));
}
