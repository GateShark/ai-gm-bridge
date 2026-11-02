export const ok = (result = null) => ({ ok: true, result });
export const fail = (code, error, extra = {}) => ({ ok: false, code, error: String(error), ...extra });
export function checkExpect(live, expect) {
  // live/expect: {combatId, round, turn}. Returns null if matching, else 409 result.
  if (!expect || typeof expect !== "object") return fail(400, "expect {combatId, round, turn} required");
  for (const k of ["combatId", "round", "turn"]) if (expect[k] === undefined) return fail(400, `expect.${k} required`);
  if (!live) return fail(409, "stale: no active combat", { live: null });
  if (live.combatId !== expect.combatId || live.round !== expect.round || live.turn !== expect.turn)
    return fail(409, "stale: combat state changed", { live });
  return null;
}
// Minimal schema validation for typed commands.
export function validate(schema, args) {
  if (!args || typeof args !== "object") return "args must be an object";
  for (const [k, t] of Object.entries(schema)) {
    const opt = t.endsWith("?"); const type = t.replace("?", "");
    const v = args[k];
    if (v === undefined || v === null) { if (opt) continue; return `${k} required`; }
    if (type === "any") continue;
    if (type === "array") { if (!Array.isArray(v)) return `${k} must be array`; continue; }
    if (type === "object" ? (typeof v !== "object" || Array.isArray(v)) : typeof v !== type) return `${k} must be ${type}`;
  }
  return null;
}
