// #13: which actor document a stat write should hit.
// An unlinked token (actorLink=false) keeps its own copy of the stats (synthetic/delta actor = token.actor),
// so writes must go there. Linked tokens, or calls without a token, write the base (world) actor.
export function targetActor({ token = null, baseActor = null } = {}) {
  if (token) {
    if (token.actorLink === false && token.actor) return { actor: token.actor, via: "token", tokenId: token.id ?? null };
    const a = token.actorLink ? (token.baseActor ?? baseActor ?? token.actor) : (baseActor ?? token.actor);
    return a ? { actor: a, via: "actor", tokenId: token.id ?? null } : null;
  }
  return baseActor ? { actor: baseActor, via: "actor", tokenId: null } : null;
}
// Shape of the extra reply fields: only mention the token when one was targeted.
export const targetInfo = (t) => t.tokenId ? { tokenId: t.tokenId, via: t.via } : {};

// Prefer a token on the viewed scene so unlinked token HP/resources are used
// when the caller only passed actorId/actorName (same idea as the panel HP list).
export function sceneTokenForActor(tokens, { actor = null, actorId = null, actorName = null } = {}) {
  if (!tokens) return null;
  const id = actor?.id ?? actorId ?? null;
  const name = String(actor?.name ?? actorName ?? "").toLowerCase();
  if (!id && !name) return null;
  const match = (t) => {
    if (!t) return false;
    if (id && (t.actorId === id || t.actor?.id === id)) return true;
    if (name && (String(t.name ?? "").toLowerCase() === name || String(t.actor?.name ?? "").toLowerCase() === name)) return true;
    return false;
  };
  if (typeof tokens.find === "function") return tokens.find(match) ?? null;
  const list = Array.isArray(tokens) ? tokens : (tokens.contents ?? []);
  return list.find(match) ?? null;
}
