// 0.9.2: player characters and their tokens. A PC's token should be LINKED (actorLink true) so the character sheet and
// the token never split. Helpers here are pure; commands.mjs does the writes.
import { hasAnyPlayerOwner, isAssignedCharacter } from "./turns.mjs";
import { readActorHp } from "./hp.mjs";

const itemList = (actor) => { const i = actor?.items; if (!i) return []; if (Array.isArray(i)) return i; if (Array.isArray(i.contents)) return i.contents; try { return [...i]; } catch { return []; } };

// A player-owned actor: a player owner on the actor (or its world/base actor), or a user's assigned character.
export function isPlayerOwned(actor, { base = null, users = [] } = {}) {
  if (!actor) return false;
  if (actor.hasPlayerOwner === true || base?.hasPlayerOwner === true) return true;
  if (hasAnyPlayerOwner(actor, base, users)) return true;
  return isAssignedCharacter(actor, users, base?.id ?? null);
}
export const worldActorOf = (token, g = globalThis.game) => { const id = token?.actorId ?? token?.actor?.id ?? null; try { return id ? (g?.actors?.get?.(id) ?? token?.baseActor ?? null) : (token?.baseActor ?? null); } catch { return token?.baseActor ?? null; } };
// An unlinked token whose actor is a player character (the case that makes sheet and token drift apart).
export function isUnlinkedPcToken(token, { users = [], g = globalThis.game } = {}) {
  if (!token || token.actorLink !== false) return false;
  const base = worldActorOf(token, g);
  return isPlayerOwned(token.actor ?? base, { base, users });
}
// For a write that resolved to an unlinked PC token: the world actor to write as well (null otherwise).
export function mirrorActor(token, opts = {}) {
  if (!isUnlinkedPcToken(token, opts)) return null;
  const base = worldActorOf(token, opts.g);
  return base && base !== token.actor ? base : null;
}
// Token-only differences the GM may want to merge by hand before the world sheet wins.
export function diffActors(tokenActor, worldActor) {
  const out = {};
  const th = readActorHp(tokenActor), wh = readActorHp(worldActor);
  if (th && wh && (th.value !== wh.value || th.max !== wh.max)) out.hp = { token: { value: th.value, max: th.max }, world: { value: wh.value, max: wh.max } };
  const ts = Number(tokenActor?.system?.silver), ws = Number(worldActor?.system?.silver);
  if (Number.isFinite(ts) && Number.isFinite(ws) && ts !== ws) out.silver = { token: ts, world: ws };
  const count = (actor) => { const m = new Map(); for (const i of itemList(actor)) { const k = `${i.type ?? ""}:${i.name}`; m.set(k, (m.get(k) ?? 0) + (Number(i.system?.quantity) || 1)); } return m; };
  const tm = count(tokenActor), wm = count(worldActor);
  const onlyOnToken = [], onlyOnWorld = [];
  for (const [k, q] of tm) { if (!wm.has(k)) onlyOnToken.push(k.split(":").slice(1).join(":")); else if (wm.get(k) !== q) onlyOnToken.push(`${k.split(":").slice(1).join(":")} (qty ${q} on token, ${wm.get(k)} on sheet)`); }
  for (const k of wm.keys()) if (!tm.has(k)) onlyOnWorld.push(k.split(":").slice(1).join(":"));
  if (onlyOnToken.length || onlyOnWorld.length) out.items = { onlyOnToken, onlyOnWorld };
  return out;
}
// Token creation data for a player-owned actor: linked, so the sheet is the token.
export const linkedTokenData = (data) => ({ ...data, actorLink: true });
