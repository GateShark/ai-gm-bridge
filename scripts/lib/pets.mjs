// 0.8.15: companion pets. Owner is stored on the pet actor as
// flags["ai-gm-bridge"].pet = { ownerId, ownerName, ownerActorId, simpleAction }.
// simpleAction (default true) is a house rule: the pet takes one simple action,
// not a full turn. We surface that in turn handling; we do not rewrite combat.

export function readPetFlag(actor) {
  const p = actor?.flags?.["ai-gm-bridge"]?.pet ?? actor?.flags?.aiGmBridge?.pet ?? null;
  if (!p || typeof p !== "object") return null;
  if (!p.ownerId && !p.ownerName && !p.ownerActorId) return null;
  return {
    ownerId: p.ownerId || null,
    ownerName: p.ownerName || null,
    ownerActorId: p.ownerActorId || null,
    simpleAction: p.simpleAction !== false
  };
}

export function petFlagData({ ownerId = null, ownerName = null, ownerActorId = null, simpleAction = true } = {}) {
  return {
    ownerId: ownerId || null,
    ownerName: ownerName || null,
    ownerActorId: ownerActorId || null,
    simpleAction: simpleAction !== false
  };
}

function toList(col) {
  if (!col) return [];
  if (Array.isArray(col)) return col;
  if (Array.isArray(col.contents)) return col.contents;
  try { return [...col]; } catch { return []; }
}

export function listPetsFrom(actors, { readPet = readPetFlag } = {}) {
  const out = [];
  for (const a of toList(actors)) {
    const pet = readPet(a);
    if (!pet) continue;
    out.push({ actorId: a.id, name: a.name, ...pet });
  }
  return out;
}

export function neighborPosition(owner, index = 0, { grid = 100 } = {}) {
  const offsets = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const i = Math.max(0, Number(index) || 0);
  const [dx, dy] = offsets[i % offsets.length];
  const ring = 1 + Math.floor(i / offsets.length);
  const cell = Math.max(1, Number(grid) || 100);
  const w = owner.w ?? ((Number(owner.width) || 1) * cell);
  const h = owner.h ?? ((Number(owner.height) || 1) * cell);
  return { x: Math.round((owner.x ?? 0) + dx * w * ring), y: Math.round((owner.y ?? 0) + dy * h * ring) };
}

export function isAdjacent(a, b, grid = 100) {
  if (!a || !b) return false;
  const cell = Math.max(1, Number(grid) || 100);
  const dx = Math.abs((a.x ?? 0) - (b.x ?? 0));
  const dy = Math.abs((a.y ?? 0) - (b.y ?? 0));
  const gw = Math.max(cell, a.w ?? ((a.width || 1) * cell), b.w ?? ((b.width || 1) * cell));
  return dx <= gw * 1.5 && dy <= gw * 1.5;
}

export function planPetPlacement({ pets = [], tokens = [], grid = 100 } = {}) {
  const tokList = (tokens ?? []).filter(Boolean);
  const byActor = new Map();
  for (const t of tokList) {
    const aid = t.actorId ?? t.actor?.id;
    if (aid && !byActor.has(aid)) byActor.set(aid, t);
  }
  const plan = [];
  let index = 0;
  for (const pet of pets ?? []) {
    const ownerTok = (pet.ownerActorId && byActor.get(pet.ownerActorId))
      || tokList.find(t => pet.ownerName && String(t.actor?.name || t.name || "").toLowerCase() === String(pet.ownerName).toLowerCase());
    if (!ownerTok) {
      plan.push({ actorId: pet.actorId, name: pet.name, action: "skip", reason: "owner token not on scene" });
      continue;
    }
    const petTok = pet.actorId ? byActor.get(pet.actorId) : null;
    const pos = neighborPosition(ownerTok, index++, { grid });
    if (petTok) {
      if (isAdjacent(petTok, ownerTok, grid) && (petTok.id !== ownerTok.id)) {
        plan.push({ actorId: pet.actorId, tokenId: petTok.id, x: petTok.x, y: petTok.y, action: "skip", reason: "already beside owner" });
      } else {
        plan.push({ actorId: pet.actorId, tokenId: petTok.id, x: pos.x, y: pos.y, action: "move" });
      }
    } else {
      plan.push({ actorId: pet.actorId, name: pet.name, x: pos.x, y: pos.y, action: "create" });
    }
  }
  return plan;
}
