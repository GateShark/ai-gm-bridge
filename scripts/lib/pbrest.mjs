// Pirate Borg rest rules, mirrored from the system's character-rest-action.js (pirateborg v1.9.0):
//  short: heal d4 if ate and not infected; grog hours -1.
//  long:  starving -> take d4; infected -> take d6; heal d8 if ate and not infected; rituals = max(d4+Spirit,0) (value and max);
//         extra resource (e.g. Prayers) = max(class formula,0) if the class uses one; Devil's Luck re-rolled (luck die) ONLY if it is 0;
//         clear grog effects.
export function planRest({ length, kind, food = "eat", infected = false } = {}) {
  const raw = length ?? kind;
  const len = raw == null || raw === "" ? "long" : String(raw).toLowerCase().trim();
  if (!["short", "long"].includes(len)) return { error: "length must be short or long" };
  if (!["eat", "starve", "donteat"].includes(food)) return { error: "food must be eat, starve or donteat" };
  const resting = food === "eat" && !infected; const s = [];
  if (len === "short") { if (resting) s.push({ step: "heal", formula: "d4" }); s.push({ step: "grogHours", by: -1 }); return { length: len, food, infected, steps: s }; }
  if (food === "starve") s.push({ step: "damage", formula: "d4", why: "starvation" });
  if (infected) s.push({ step: "damage", formula: "d6", why: "infection" });
  if (resting) s.push({ step: "heal", formula: "d8" });
  s.push({ step: "rituals" }, { step: "extraResource" }, { step: "luckIfZero" }, { step: "clearGrog" });
  return { length: len, food, infected, steps: s };
}
export const clampHp = (v, max) => Math.max(0, typeof max === "number" && max > 0 ? Math.min(max, v) : v);
export function diffReport(before, after) {
  const out = []; for (const k of Object.keys(after)) if (before[k] !== after[k]) out.push(`${k} ${before[k] ?? "-"}→${after[k]}`);
  return out.join(", ") || "no change";
}

// Don't restore a pool the actor does not have (e.g. rituals max 0).
export function canRestoreResource(actor, name) {
  if (name === "rituals") {
    const r = actor?.system?.attributes?.rituals;
    return !!(r && typeof r === "object" && Number(r.max) > 0);
  }
  if (name === "extraResource") {
    if (!actor?.useExtraResource) return false;
    const r = actor?.system?.attributes?.extraResource;
    if (r && typeof r.max === "number") return r.max > 0;
    return true;
  }
  return false;
}
