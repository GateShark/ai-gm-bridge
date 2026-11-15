// 0.9.0 #4: GM-only test fight. Calm music, a few enemies next to the party, combat started in the tracker.
export const TEST_FIGHT_FLAG = "testFight";
export const TEST_ENEMY = { name: "Test Bilge Rat", type: "creature", system: { attributes: { hp: { value: 3, max: 3 }, morale: 6 } } };
const list = (x) => Array.isArray(x) ? x : [...(x?.contents ?? x ?? [])];
export function pickTestEnemy(actors, name = null) {
  const all = list(actors);
  if (name) { const n = String(name).toLowerCase(); return all.find(a => a?.id === name || String(a?.name ?? "").toLowerCase() === n) ?? null; }
  const creatures = all.filter(a => a?.type === "creature");
  return creatures.find(a => a.getFlag?.("ai-gm-bridge", TEST_FIGHT_FLAG) || a.flags?.["ai-gm-bridge"]?.[TEST_FIGHT_FLAG])
    ?? creatures.find(a => /\brats?\b/i.test(a.name)) ?? creatures[0] ?? null;
}
export function planTestFight({ count = 3, scene = null, pcTokens = [], grid = null } = {}) {
  const n = Math.max(1, Math.min(6, Math.floor(Number(count) || 3)));
  const g = Number(grid ?? scene?.grid?.size ?? scene?.grid) || 100;
  const anchor = pcTokens[0];
  const ax = Number(anchor?.x ?? ((Number(scene?.width) || g * 10) / 2));
  const ay = Number(anchor?.y ?? ((Number(scene?.height) || g * 10) / 2));
  const spots = [];
  for (let i = 0; i < n; i++) spots.push({ x: ax + g * (2 + (i % 3)), y: ay + g * Math.floor(i / 3) });
  return { count: n, spots };
}
export function testFightTokenData(base, i, spot, tag) {
  return { ...base, name: `${base?.name ?? "Enemy"} ${i + 1}`, x: Math.round(spot.x), y: Math.round(spot.y), disposition: -1, actorLink: false, hidden: false,
    flags: { ...(base?.flags ?? {}), "ai-gm-bridge": { ...(base?.flags?.["ai-gm-bridge"] ?? {}), [TEST_FIGHT_FLAG]: tag } } };
}
