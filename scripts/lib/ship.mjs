// v0.8 Pirate Borg ship + morale helpers (pure). The Foundry side (scripts/ship.mjs) imports the pirateborg system's own
// outcome builders (module/api/outcome/...) and calls them without the crew-action dialog; this file only maps names and does math.
export const SHIP_TYPES = ["vehicle", "vehicle_npc"];
export const PB_API = "systems/pirateborg/module/api";
// key: system outcome module + export, the system's own title/description i18n keys, and which dialog inputs it takes.
export const ACTIONS = {
  broadsides: { file: "outcome/ship/ship-broadsides-outcome.js", fn: "createBroadsidesOutcome", title: "PB.ShipCrewActionBroadsides", desc: "PB.ShipBroadsidesMessage", crew: true, dr: true, armor: true, target: true },
  smallArms: { file: "outcome/ship/ship-smallarms-outcome.js", fn: "createSmallarmsOutcome", title: "PB.ShipCrewActionSmallArms", desc: "PB.ShipSmallArmsMessage", crew: true, dr: true, armor: true, target: true },
  ram: { file: "outcome/ship/ship-ram-outcome.js", fn: "createRamOutcome", title: "PB.ShipCrewActionRam", desc: "PB.ShipRamMessage", armor: true, target: true, movement: true },
  repair: { file: "outcome/ship/ship-repair-outcome.js", fn: "createRepairOutcome", title: "PB.ShipCrewActionRepair", desc: "PB.ShipRepairMessage", crew: true, dr: true },
  fullSail: { file: "outcome/ship/ship-full-sail-outcome.js", fn: "createFullSailOutcome", title: "PB.ShipCrewActionFullSail", desc: "PB.ShipFullSailMessage", crew: true, dr: true },
  comeAbout: { file: "outcome/ship/ship-come-about-outcome.js", fn: "createComeAboutOutcome", title: "PB.ShipCrewActionComeAbout", desc: "PB.ShipComeAboutMessage", crew: true, dr: true },
  dropAnchor: { file: "outcome/ship/ship-drop-anchor-outcome.js", fn: "createDropAnchorOutcome", title: "PB.ShipCrewActionDropAnchor", desc: "PB.ShipDropAnchorMessage" },
  weighAnchor: { file: "outcome/ship/ship-weigh-anchor-outcome.js", fn: "createWeighAnchorOutcome", title: "PB.ShipCrewActionWeighAnchor", desc: "PB.ShipWeighAnchorMessage" },
  shanty: { file: "outcome/ship/ship-invoke-shanty-outcome.js", fn: "createInvokeShantyOutcome", title: "PB.ShipShantyButton", shanty: true },
  sink: { file: "outcome/ship/ship-sinking-outcome.js", fn: "createSinkingOutcome", title: "PB.ShipSinking", desc: "PB.ShipSinkingMessage" },
};
const ALIAS = { broadside: "broadsides", smallarms: "smallArms", arms: "smallArms", ram: "ram", repair: "repair", fullsail: "fullSail", sail: "fullSail",
  comeabout: "comeAbout", turn: "comeAbout", dropanchor: "dropAnchor", anchor: "dropAnchor", weighanchor: "weighAnchor", shanty: "shanty", sing: "shanty", sink: "sink", sinking: "sink" };
export function normAction(name) {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ACTIONS[name] ? name : ALIAS[n] ?? Object.keys(ACTIONS).find(k => k.toLowerCase() === n) ?? null;
}
// pirateborg CONFIG.PB.armorTiers damageReductionDie, used when CONFIG isn't there (tests). Ship hull = armor tier.
export const HULL_DIE = { 0: "0", 1: "1d2", 2: "1d4", 3: "1d6" };
export const isShip = (a) => SHIP_TYPES.includes(a?.type);
// Compact ship view from actor.system (template.json "vehicle").
export function shipSummary(a, hullDie = HULL_DIE) {
  const s = a.system ?? {}, at = s.attributes ?? {}, w = s.weapons ?? {};
  const hp = at.hp ?? {}, hull = at.hull?.value ?? 0;
  return { actorId: a.id, name: a.name, type: a.type, hp: { value: hp.value, max: hp.max }, hull, armorDie: hullDie[hull] ?? "0",
    agility: s.abilities?.agility?.value ?? 0, skill: s.abilities?.skill?.value ?? 0, speed: at.speed?.value ?? null,
    crew: { value: at.crew?.value ?? 0, max: at.crew?.max ?? 0 }, shanties: { value: at.shanties?.value ?? 0, max: at.shanties?.max ?? 0 },
    cargo: { value: at.cargo?.value ?? 0, max: at.cargo?.max ?? 0 },
    weapons: { broadsides: { die: w.broadsides?.die || null, quantity: w.broadsides?.quantity ?? 0 }, smallArms: { die: w.smallArms?.die || null, quantity: w.smallArms?.quantity ?? 0 }, ram: { die: w.ram?.die || null } },
    sinking: typeof hp.value === "number" && hp.value <= 0 };
}
// Damage after hull: amount - reduction (never below 0); HP goes down by that, never below 0 (the system leaves it to the sheet).
export function applyDamage(hp, amount, reduction = 0) {
  const dmg = Math.max(0, Math.round(Number(amount) - Number(reduction || 0)));
  const after = Math.max(0, (hp?.value ?? 0) - dmg);
  return { damage: dmg, before: hp?.value ?? 0, after, sinking: after <= 0 };
}
// Same rule as the system's createMoraleOutcome: 2d6 <= morale stands; else 1d6 1-3 flees, 4-6 surrenders.
export function moraleResult(total, morale, second) {
  if (total <= morale) return "stands";
  return second == null ? null : second <= 3 ? "flees" : "surrenders";
}
export function parseMorale(v) { const n = Number(v); return v === "-" || v === "" || v == null || !Number.isFinite(n) ? null : n; }
// Lean result from a system outcome object (no HTML, no roll internals).
export function leanOutcome(o) {
  if (!o) return null;
  const r = { title: o.title || undefined, total: o.roll?.total, formula: o.formulaLabel ?? o.formula };
  if (typeof o.dr === "number") Object.assign(r, { dr: o.dr, success: o.isSuccess === true, crit: o.isCriticalSuccess === true, fumble: o.isFumble === true });
  if (o.damageFormula) r.damageFormula = o.damageFormula;
  if (typeof o.totalDamage === "number") r.damage = o.totalDamage;
  if (o.draw?.results?.length || o.drawResult) r.text = o.description || undefined;
  for (const k of ["isNothing", "isSinking", "isExplosion", "isMajorExplosion", "isFatalExplosion"]) if (o[k]) r.sinkResult = k.slice(2);
  return r;
}
// Outcome ids we posted ourselves, so the chat hook skips them (no bot wake for our own cards).
const own = new Map();
export function markOwn(ids, now = Date.now()) { for (const id of ids) if (id) own.set(id, now); for (const [k, t] of own) if (now - t > 600000) own.delete(k); }
export function isOwn(msg) { const outs = msg?.flags?.pirateborg?.outcomes; return Array.isArray(outs) && outs.some(o => own.has(o?.id)); }
// Local shortcut parse helpers: "!broadsides Black Gull dr 14" -> {action, name, dr}
export function splitDr(words) { const w = [...words]; let dr; const i = w.findIndex(x => /^dr$/i.test(x)); if (i >= 0 && /^\d+$/.test(w[i + 1] ?? "")) { dr = Number(w[i + 1]); w.splice(i, 2); } return { name: w.join(" "), dr }; }
