// v0.8 Pirate Borg morale + ship combat. Reuses the pirateborg system's own outcome builders and chat card
// (module/api/outcome/*, chat-message/generic-card.js) exactly as its sheet does, minus the crew-action dialog.
// Results go back to the caller; cards we post are marked so they never wake the bot.
import { ok, fail } from "./lib/result.mjs";
import { ACTIONS, PB_API, HULL_DIE, normAction, isShip, shipSummary, applyDamage, moraleResult, parseMorale, leanOutcome, markOwn } from "./lib/ship.mjs";

let loader = async (path) => import(globalThis.foundry?.utils?.getRoute ? foundry.utils.getRoute(path) : "/" + path);
export function setLoader(fn) { loader = fn; }
const sys = (rel) => loader(`${PB_API}/${rel}`);
const card = async (opts) => { markOwn((opts.outcomes ?? []).map(o => o?.id)); const m = await loader("systems/pirateborg/module/chat-message/generic-card.js"); return m.showGenericCard(opts); };
const L = (k) => k ? (game.i18n?.localize?.(k) ?? k) : undefined;
// Default matches the system (its ram passes armorOutcome.total, undefined, so armour is rolled and shown but not subtracted).
const ramUsesArmor = () => { try { return game.settings.get("ai-gm-bridge", "ramUsesArmor") === true; } catch { return false; } };
const pbOnly = () => game.system?.id === "pirateborg" ? null : fail(400, "needs the pirateborg system");
const hullDies = () => { const t = globalThis.CONFIG?.PB?.armorTiers; return t ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.damageReductionDie])) : HULL_DIE; };
const tokenObj = (doc) => doc ? (doc.object ?? globalThis.canvas?.tokens?.get?.(doc.id) ?? null) : null;

export async function moraleCheck(actor, a = {}) {
  const no = pbOnly(); if (no) return no;
  const morale = parseMorale(a.morale) ?? parseMorale(actor?.system?.attributes?.morale);
  if (morale === null) return fail(400, "no morale value: pass morale or use a creature with one");
  const { createMoraleOutcome } = await sys("outcome/creature/morale-outcome.js");
  const o = await createMoraleOutcome({ actor: { morale } }); // the builder only reads actor.morale
  const second = o.secondaryOutcome?.roll?.total ?? null;
  const result = o.isStandingFirm ? "stands" : o.isFleeing ? "flees" : o.isSurrendering ? "surrenders" : moraleResult(o.roll?.total, morale, second);
  if (a.toChat !== false) await card({ title: L("PB.Morale"), actor, outcomes: [o] });
  return ok({ actorId: actor?.id ?? null, name: actor?.name ?? null, morale, total: o.roll?.total, second, result });
}

export async function shipAction(actor, a = {}, { findActor, findToken }) {
  const no = pbOnly(); if (no) return no;
  if (!isShip(actor)) return fail(400, `${actor.name} is not a ship (vehicle)`);
  const key = normAction(a.action); if (!key) return fail(400, `unknown action ${a.action}; one of ${Object.keys(ACTIONS).join(", ")}`);
  const d = ACTIONS[key];
  const crew = d.crew && (a.crewActorId || a.crewActorName) ? findActor({ actorId: a.crewActorId, actorName: a.crewActorName }) : undefined;
  if (crew === null) return fail(404, "crew actor not found");
  let target;
  if (d.target && (a.targetTokenId || a.targetTokenName)) { const doc = findToken({ tokenId: a.targetTokenId, tokenName: a.targetTokenName, sceneId: a.sceneId });
    target = tokenObj(doc); if (!target) return fail(404, "target token not found on the viewed scene"); }
  const armorFormula = d.armor ? (a.armor ?? target?.actor?.getActorArmorFormula?.() ?? "0") : undefined;
  const dr = d.dr ? (a.dr ?? 12) : undefined;
  if (d.shanty && !(actor.system?.attributes?.shanties?.value >= 1)) return fail(409, "no shanties left");
  const outcomes = []; const mod = await sys(d.file);
  if (key === "ram") { // as shipRamAction: armor roll, inflict (ramDie + movement, scaled by ship size), then the ram outcome
    const { createArmorOutcome } = await sys("outcome/actor/armor-outcome.js");
    const { createInflictDamageOutcome } = await sys("outcome/actor/inflict-damage-outcome.js");
    const armorO = await createArmorOutcome({ formula: armorFormula });
    const formula = actor.getScaledDamageFormula(target?.actor, `${actor.system?.weapons?.ram?.die || "0"} + ${Number(a.movement ?? 0)}`);
    const dmg = await createInflictDamageOutcome({ actor, formula, damageReduction: ramUsesArmor() ? (armorO.roll?.total ?? 0) : 0, targetToken: target });
    outcomes.push(await mod[d.fn]({ actor, targetToken: target }), dmg, armorO);
  } else outcomes.push(await mod[d.fn]({ actor, crew, dr, armorFormula, targetToken: target }));
  if (d.shanty) await actor.updateShanties({ value: Math.max(0, actor.system.attributes.shanties.value - 1) });
  if (a.toChat !== false) await card({ actor, title: L(d.title), description: L(d.desc), outcomes, target });
  const [main, ...rest] = outcomes;
  return ok({ actorId: actor.id, action: key, target: target?.name ?? null, crew: crew?.name ?? null, ...leanOutcome(main),
    ...(rest.length ? { damage: rest[0]?.totalDamage, ...(key === "ram" && !ramUsesArmor() ? { armorRoll: rest[1]?.roll?.total } : { armor: rest[1]?.roll?.total }) } : {}),
    ...(d.shanty ? { shantiesLeft: actor.system.attributes.shanties.value } : {}) });
}

export async function shipDamage(actor, a = {}) {
  const no = pbOnly(); if (no) return no;
  if (!isShip(actor)) return fail(400, `${actor.name} is not a ship (vehicle)`);
  if ((a.amount == null) === (a.formula == null)) return fail(400, "give exactly one of amount or formula");
  let amount = Number(a.amount);
  if (a.formula != null) { try { amount = (await new Roll(String(a.formula)).evaluate()).total; } catch (e) { return fail(400, `bad formula: ${e.message}`); } }
  if (!Number.isFinite(amount) || amount < 0) return fail(400, "amount must be a number >= 0");
  let reduction = 0, armorDie = null;
  if (a.armor !== false) { armorDie = actor.getActorArmorFormula?.() ?? hullDies()[actor.system?.attributes?.hull?.value ?? 0];
    if (armorDie && armorDie !== "0") reduction = (await new Roll(armorDie).evaluate()).total; }
  const r = applyDamage(actor.system.attributes.hp, amount, reduction);
  if (actor.updateHp) await actor.updateHp({ value: r.after }); else await actor.update({ "system.attributes.hp.value": r.after });
  if (a.toChat !== false) await ChatMessage.create({ content: `<b>${actor.name}</b> takes ${r.damage} damage${armorDie && armorDie !== "0" ? ` (rolled ${amount}, hull ${armorDie} −${reduction})` : ""}. HP ${r.before} → ${r.after}${r.sinking ? " — <b>sinking!</b>" : ""}`,
    speaker: { alias: "AI GM" }, flags: { "ai-gm-bridge": { local: true } } });
  return ok({ actorId: actor.id, rolled: amount, armorDie, reduction, ...r });
}

export function getShip(actor) {
  if (!isShip(actor)) return fail(400, `${actor.name} is not a ship (vehicle)`);
  const s = shipSummary(actor, hullDies()); const nm = (id) => game.actors?.get?.(id)?.name ?? null;
  const crews = actor.system?.crews ?? []; const cap = actor.system?.captain ?? null;
  return ok({ ...s, captain: cap ? nm(cap) : null, crewActors: crews.map(nm).filter(Boolean) });
}
