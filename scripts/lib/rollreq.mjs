// requestRoll (pure parts): stat names, card HTML, who may click, result evaluation, roll-message matching.
export const STATS = { strength: "strength", str: "strength", agility: "agility", agi: "agility", presence: "presence", pre: "presence",
  toughness: "toughness", tou: "toughness", spirit: "spirit", spi: "spirit" };
export const normStat = (s) => STATS[String(s ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? null;
export const formulaFor = (stat) => `1d20 + @abilities.${stat}.value`;
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
  const head = `<div class="aigm-rollreq" data-request-id="${esc(req.id)}"><b>${esc(title)}</b>${dr}<br>${esc(req.actorName)} (${esc(req.userName)})`;
  if (req.status === "pending") return `${head}<br><button type="button" data-aigm-roll="${esc(req.id)}">Roll ${req.formula ? esc(req.formula) : cap(req.stat)}</button></div>`;
  if (req.status === "expired") return `${head}<br><i>Expired.</i></div>`;
  if (req.status === "timeout") return `${head}<br><i>No roll yet.</i> <button type="button" data-aigm-roll="${esc(req.id)}" data-gm-only="1">GM: roll for them</button></div>`;
  const r = req.result; return `${head}<br><b>${r.total}</b>${r.success === null || r.success === undefined ? "" : ` → ${r.crit ? "CRIT " : r.fumble ? "FUMBLE " : ""}${r.success ? "success" : "fail"}`}${req.answeredBy ? ` <small>(${esc(req.answeredBy)})</small>` : ""}</div>`;
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
export const isOpen = (p, now) => p.status !== "done" && p.status !== "expired" && !(p.expireAt && now >= p.expireAt);
// Is this chat message the answer to an open request? Explicit flag wins (card button). Otherwise (sheet roll or Pixels) the
// d20 roll must come from the requested player (or a GM rolling for the card's actor), after the card, and:
//   1. if the message speaks for an actor, only cards for that actor;  2. if the ability is known, only cards for that ability;
//   3. oldest remaining card.
export function matchRoll(msg, pending, now = Date.now()) {
  const rolls = rollsOf(msg); if (!rolls.length) return null;
  const open = pending.filter(p => isOpen(p, now));
  const flagged = msg.flags?.["ai-gm-bridge"]?.rollRequestId;
  if (flagged) return open.find(p => p.id === flagged) ?? null;
  if (!rolls.some(r => /d20/i.test(r.formula) || /d20/i.test(r.raw))) return null;
  const author = msg.author ?? msg.user; const by = typeof author === "string" ? author : author?.id; const gm = typeof author === "object" && !!author?.isGM;
  const actorId = msg.speaker?.actor ?? null; const stat = abilityOf(msg, rolls);
  let c = open.filter(p => (!p.formula || /d20/i.test(p.formula)) && (msg.timestamp ?? Infinity) >= p.at && (p.userId === by || (gm && actorId && p.actorId === actorId)));
  if (actorId) c = c.filter(p => p.actorId === actorId);
  if (stat) c = c.filter(p => p.stat === stat);
  return c.sort((a, b) => a.at - b.at)[0] ?? null;
}
export function d20Of(msg) { const r = rollsOf(msg); return (r.find(x => /d20/i.test(x.formula) || /d20/i.test(x.raw)) ?? r[0])?.roll ?? null; }
export function naturalOf(roll) {
  for (const t of roll?.dice ?? roll?.terms ?? []) if (t.faces === 20 && t.results?.length) return t.results.find(r => r.active !== false)?.result ?? t.results[0].result;
  return null;
}
