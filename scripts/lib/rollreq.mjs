// requestRoll (pure parts): stat names, card HTML, who may click, result evaluation, roll-message matching.
export const STATS = { strength: "strength", str: "strength", agility: "agility", agi: "agility", presence: "presence", pre: "presence",
  toughness: "toughness", tou: "toughness", spirit: "spirit", spi: "spirit" };
export const normStat = (s) => STATS[String(s ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? null;
export const formulaFor = (stat) => `1d20 + @abilities.${stat}.value`;
export function normalizeFormula(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^d\d/i.test(s)) return `1${s}`;
  return s;
}
export function diceFaces(formula) {
  const out = [];
  const re = /(\d*)d(\d+)/gi;
  let m;
  while ((m = re.exec(String(formula ?? "")))) out.push(Number(m[2]));
  return out;
}
// PB test: d20 + ability >= DR. Natural 20 = crit (success), natural 1 = fumble (fail).
export function evaluate({ total, natural, dr }) {
  const crit = natural === 20, fumble = natural === 1; const t = Number(total), d = Number(dr);
  return { total, natural: natural ?? null, dr, success: crit ? true : fumble ? false : (Number.isFinite(t) && Number.isFinite(d) && t >= d), crit: !!crit, fumble: !!fumble };
}
// 0.8.4 #15: any-formula requests. Result: total, success only when a DR was given; crit/fumble only for a natural d20.
export function evaluateFormula({ total, natural, dr }) {
  const hasDr = dr !== undefined && dr !== null && Number.isFinite(Number(dr));
  if (hasDr && natural != null) return evaluate({ total, natural, dr });
  return { total, natural: natural ?? null, dr: hasDr ? dr : null, success: hasDr ? Number(total) >= Number(dr) : null, crit: false, fumble: false };
}
export const reqFormula = (req) => req.formula || formulaFor(req.stat);
export function canClick(req, user) { return !!user && (user.isGM || user.id === req.userId); }
export const reqIdFrom = (requestId, seed) => requestId || `rr-${seed}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function cardHtml(req) {
  const title = req.label || (req.formula ? req.formula : `${cap(req.stat)} test`); const dr = req.dr != null ? ` — DR ${req.dr}` : "";
  const head = `<div class="aigm-rollreq" data-request-id="${esc(req.id)}" data-status="${esc(req.status)}"><b>${esc(title)}</b>${dr}<br>${esc(req.actorName)} (${esc(req.userName)})${req.bonus ? ` <small>${req.bonus < 0 ? "−" : "+"}${Math.abs(req.bonus)}${req.bonusLabel ? ` ${esc(req.bonusLabel)}` : ""}</small>` : ""}`;
  const rollBtn = `<button type="button" class="aigm-roll-btn" data-aigm-roll="${esc(req.id)}">Roll ${req.formula ? esc(req.formula) : cap(req.stat)}</button>`;
  if (req.status === "pending") return `${head}<br>${rollBtn}</div>`;
  if (req.status === "expired") return `${head}<br><i>Expired.</i></div>`;
  if (req.status === "cancelled") return `${head}<br><i>Cancelled.</i></div>`;
  if (req.status === "timeout") return `${head}<br><i>Still waiting — you can still roll.</i> ${rollBtn} <button type="button" class="aigm-roll-btn" data-aigm-roll="${esc(req.id)}" data-gm-only="1">GM: roll for them</button></div>`;
  const r = req.result; return `${head}<br>${r.breakdown ? `${esc(r.breakdown)} → ` : ""}<b>${r.total}</b>${esc(bonusText(r))}${r.success === null || r.success === undefined ? "" : ` → ${r.crit ? "CRIT " : r.fumble ? "FUMBLE " : ""}${r.success ? "success" : "fail"}`}${req.answeredBy ? ` <small>(${esc(req.answeredBy)})</small>` : ""}</div>`;
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
// Rolls carried by a chat message. Core rolls live in msg.rolls. Pirate Borg sheet rolls (showGenericCard) put NO rolls in
// msg.rolls: each outcome sits in flags.pirateborg.outcomes[] with a serialized Roll in .roll and the raw formula
// (e.g. "1d20+@abilities.agility.value") in .formula.
export function rollsOf(msg) {
  const out = (msg.rolls ?? []).map(r => ({ roll: r, formula: r.formula ?? "", raw: "" }));
  for (const o of msg.flags?.pirateborg?.outcomes ?? []) if (o?.roll) out.push({ roll: o.roll, formula: o.roll.formula ?? o.formula ?? "", raw: o.formula ?? "" });
  return out;
}
const STAT_RE = /\b(strength|agility|presence|toughness|spirit)\b/i;
// Which ability a roll message tests: our flag, the raw @abilities.X formula, then flavor/card title text.
export function abilityOf(msg, rolls = rollsOf(msg)) {
  const f = msg.flags?.["ai-gm-bridge"]?.rollStat; if (f) return f;
  for (const r of rolls) { const m = /@?abilities\.(\w+)/.exec(r.raw || r.formula); if (m) return normStat(m[1]); }
  const m = STAT_RE.exec(`${msg.flavor ?? ""} ${String(msg.content ?? "").replace(/<[^>]+>/g, " ")}`); return m ? m[1].toLowerCase() : null;
}
export const isOpen = (p, now) => p.status !== "done" && p.status !== "expired" && p.status !== "cancelled" && !(p.expireAt && now >= p.expireAt);
// Is this chat message the answer to an open request? Explicit flag wins (card button). Otherwise (sheet roll or Pixels) the
// d20 roll must come from the requested player (or a GM rolling for the card's actor), after the card, and:
//   1. if the message speaks for an actor, only cards for that actor;  2. if the ability is known, only cards for that ability;
//   3. oldest remaining card.
export function matchRoll(msg, pending, now = Date.now()) {
  const rolls = rollsOf(msg); if (!rolls.length) return null;
  const open = pending.filter(p => isOpen(p, now));
  const flagged = msg.flags?.["ai-gm-bridge"]?.rollRequestId;
  if (flagged) return open.find(p => p.id === flagged) ?? null;
  const author = msg.author ?? msg.user; const by = typeof author === "string" ? author : author?.id; const gm = typeof author === "object" && !!author?.isGM;
  const actorId = msg.speaker?.actor ?? null; const stat = abilityOf(msg, rolls);
  let eligible = open.filter(p => (msg.timestamp ?? Infinity) >= p.at && (p.userId === by || (gm && actorId && p.actorId === actorId)));
  if (actorId) eligible = eligible.filter(p => p.actorId === actorId);
  for (const r of rolls) {
    const faces = diceFaces(r.formula || r.raw);
    if (!faces.length || faces.every(f => f === 20)) continue;
    const hit = eligible.filter(p => p.formula && diceFaces(p.formula).some(f => faces.includes(f)))
      .sort((a, b) => a.at - b.at)[0];
    if (hit) return hit;
  }
  if (!rolls.some(r => /d20/i.test(r.formula) || /d20/i.test(r.raw))) return null;
  let c = eligible.filter(p => !p.formula || /d20/i.test(p.formula));
  if (stat) c = c.filter(p => p.stat === stat);
  return c.sort((a, b) => a.at - b.at)[0] ?? null;
}
export function d20Of(msg) { const r = rollsOf(msg); return (r.find(x => /d20/i.test(x.formula) || /d20/i.test(x.raw)) ?? r[0])?.roll ?? null; }
export function naturalOf(roll) {
  for (const t of roll?.dice ?? roll?.terms ?? []) if (t.faces === 20 && t.results?.length) return t.results.find(r => r.active !== false)?.result ?? t.results[0].result;
  return null;
}
// v0.8.6: raw dice + modifier, e.g. "d20 19 + 1 = 20". Works on live Rolls and serialized ones (terms/dice with faces+results).
// Returns { dice:[{faces, number, results:[n], kept:[n]}], modifier, text } or null when there are no dice.
export function rollBreakdown(roll) {
  const terms = (roll?.dice?.length ? roll.dice : (roll?.terms ?? []).filter(t => t?.faces && Array.isArray(t.results)));
  if (!terms.length || !Number.isFinite(Number(roll?.total))) return null;
  const dice = terms.map(t => { const all = t.results.map(r => r.result), kept = t.results.filter(r => r.active !== false && !r.discarded).map(r => r.result);
    return { faces: t.faces, number: t.number ?? all.length, results: all, kept }; });
  const sum = dice.reduce((s, d) => s + d.kept.reduce((a, b) => a + b, 0), 0), total = Number(roll.total), modifier = total - sum;
  const dtext = dice.map(d => `${d.number > 1 ? d.number : ""}d${d.faces} ${d.kept.join("+")}`).join(" + ");
  const text = `${dtext}${modifier ? ` ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}` : ""} = ${total}`;
  return { dice, modifier, text };
}

// 0.8.20 #13: an active roll bonus (e.g. a +10 test mode) counts when the card judges pass/fail.
// total stays the raw roll; finalTotal = total + bonus; success/crit/fumble use finalTotal.
export function normBonus(n) { const v = Number(n); return Number.isFinite(v) ? Math.trunc(v) : 0; }
export function judgeWithBonus(result, req) {
  const bonus = normBonus(req?.bonus);
  if (!bonus || !result) return result;
  const raw = Number(result.total);
  if (!Number.isFinite(raw)) return result;
  const finalTotal = raw + bonus;
  const judged = req.formula
    ? evaluateFormula({ total: finalTotal, natural: result.natural ?? null, dr: req.dr })
    : evaluate({ total: finalTotal, natural: result.natural ?? null, dr: req.dr });
  return { ...result, ...judged, total: raw, finalTotal, bonus, ...(req.bonusLabel ? { bonusLabel: String(req.bonusLabel) } : {}) };
}
export function bonusText(r) {
  if (!r?.bonus) return "";
  return ` ${r.bonus < 0 ? "−" : "+"}${Math.abs(r.bonus)}${r.bonusLabel ? ` (${r.bonusLabel})` : ""} = ${r.finalTotal}`;
}
// Standing bonuses: { "actor:<id>": {bonus,label}, "user:<id>": {...} }. Actor wins over user.
export function standingBonus(map, { actorId, userId } = {}) {
  const m = map && typeof map === "object" ? map : {};
  const hit = (actorId && m[`actor:${actorId}`]) || (userId && m[`user:${userId}`]) || null;
  const bonus = normBonus(hit?.bonus);
  return bonus ? { bonus, label: hit?.label ? String(hit.label) : "" } : null;
}

// 0.8.20 #15: one roll card per attack/event. A new request is the same as an open card when it is for the same
// player, actor, and test (stat or formula) and the same DR, and either: the bot passes the same rollKey, the labels
// match, it is the same combat turn (round+turn), or (outside combat) it comes within NEAR_DUP_MS of the open card.
export const NEAR_DUP_MS = 90000;
const normLabel = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const testOf = (r) => String(r?.formula || r?.stat || "").replace(/\s+/g, "").toLowerCase();
export function nearDuplicateRequest(open, want, now = Date.now()) {
  if (!open || !want) return false;
  if (open.userId !== want.userId || open.actorId !== want.actorId) return false;
  if (open.rollKey || want.rollKey) return !!open.rollKey && open.rollKey === want.rollKey;
  if (testOf(open) !== testOf(want)) return false;
  if (normLabel(open.label) === normLabel(want.label)) return true;
  const drA = open.dr ?? null, drB = want.dr ?? null;
  if (drA !== drB) return false;
  if (open.combatId || want.combatId) {
    return !!open.combatId && open.combatId === want.combatId && open.round != null && open.round === want.round && open.turn === want.turn;
  }
  return Math.abs(Number(now) - Number(open.at || 0)) < NEAR_DUP_MS;
}
export function findNearDuplicate(pending, want, now = Date.now()) {
  return (pending ?? []).filter(p => isOpen(p, now)).find(p => nearDuplicateRequest(p, want, now)) ?? null;
}
