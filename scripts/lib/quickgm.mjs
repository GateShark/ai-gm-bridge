// 0.8.15: pure helpers for in-game GM table / loot / damage buttons.
// 0.8.16: giveLoot and applyDamage share the same target-argument shapes.

function toList(col) {
  if (!col) return [];
  if (Array.isArray(col)) return col;
  if (Array.isArray(col.contents)) return col.contents;
  try { return [...col]; } catch { return []; }
}

export function listTables(tables = []) {
  return toList(tables).map(t => ({ id: t.id, name: t.name })).filter(t => t.id && t.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function planDamage(targets = [], amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return { error: "amount must be a number" };
  const dmg = Math.abs(n);
  return {
    amount: dmg,
    updates: (targets ?? []).map(t => {
      const before = t.hp?.value ?? t.value;
      const after = typeof before === "number" && Number.isFinite(before) ? Math.max(0, before - dmg) : null;
      return { id: t.id ?? t.actorId ?? null, name: t.name, before: before ?? null, after };
    }).filter(u => u.id)
  };
}

export function isItemResult(r) {
  if (!r) return false;
  const type = r.type;
  if (type === "pack" || type === "Item" || type === "document" || type === 1 || type === 2) return true;
  if (r.documentUuid || r.documentCollection === "Item") return true;
  return false;
}

export function planLoot(results = []) {
  const items = [];
  const texts = [];
  for (const r of results ?? []) {
    const name = r.name || r.text || r.documentName || null;
    if (isItemResult(r)) items.push({ name: name || "item", uuid: r.documentUuid || null, id: r.documentId || null });
    else if (name) texts.push(String(name));
  }
  return { items, texts };
}

export function summarizeDraw(results = [], tableName = null) {
  const list = Array.isArray(results) ? results : [];
  const text = list.map(r => r.text || r.name || r.documentName).filter(Boolean).join("; ");
  return { table: tableName || null, text };
}

function asIdList(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v.flatMap(asIdList);
  return [String(v)].filter(Boolean);
}

function uniqueIds(xs) {
  const out = [];
  const seen = new Set();
  for (const x of xs) {
    if (x == null || x === "") continue;
    const s = String(x);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Union of the giveLoot (singular token/actor + scene) and applyDamage
// (tokenIds/actorIds arrays) shapes. Extra keys are ignored.
export function normalizeTargetArgs(a = {}) {
  const tokenIds = uniqueIds([...asIdList(a.tokenIds), ...asIdList(a.tokenId)]);
  const tokenNames = uniqueIds([...asIdList(a.tokenNames), ...asIdList(a.tokenName)]);
  const actorIds = uniqueIds([...asIdList(a.actorIds), ...asIdList(a.actorId)]);
  const actorNames = uniqueIds([...asIdList(a.actorNames), ...asIdList(a.actorName)]);
  return {
    tokenIds, tokenNames, actorIds, actorNames,
    sceneId: a.sceneId || null,
    hasExplicit: !!(tokenIds.length || tokenNames.length || actorIds.length || actorNames.length)
  };
}
