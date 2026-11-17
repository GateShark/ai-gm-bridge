// v0.8.1 helpers: move fallback, v14 scene background, result formatting.

// Move: normal update first; if the token doesn't arrive (v14 movement can be constrained/rejected), retry once
// with TokenDocument.move as a 'displace' that ignores walls and cost. Returns {reached, x, y, via}.
export async function moveWithFallback(t, x, y, wait) {
  let w = wait(); await t.update({ x, y }, { animate: false }); let r = await w;
  if (r.reached) return { ...r, via: "update" };
  if (typeof t.move !== "function") return { ...r, via: "update" };
  w = wait();
  await t.move({ x, y, action: "displace" }, { constrainOptions: { ignoreWalls: true, ignoreCost: true } });
  r = await w; return { ...r, via: "displace" };
}

// 0.9.3: which Foundry core generation is running (13, 14, ...). game.release.generation is the documented number; older
// builds only have a version string like "14.369". Returns null when neither is there (tests, odd hosts).
export function coreGeneration(g = globalThis.game) {
  const gen = Number(g?.release?.generation);
  if (Number.isFinite(gen) && gen > 0) return Math.floor(gen);
  const m = String(g?.version ?? g?.data?.version ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
const levelList = (scene) => {
  const raw = scene?.levels; if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (Array.isArray(raw.contents)) return raw.contents.filter(Boolean);
  try { return [...raw].filter(Boolean); } catch { return []; }
};
// A scene keeps its background on a Level from Foundry v14 on. With a known core number that decides; with none, a scene that
// has a levels collection counts.
export function sceneUsesLevels(scene, g = globalThis.game) {
  const gen = coreGeneration(g);
  if (gen != null) return gen >= 14;
  return !!scene?.levels && (levelList(scene).length > 0 || Array.isArray(scene.levels.contents));
}
export const DEFAULT_LEVEL_ID = "defaultLevel0000";
// 0.9.3: v14 and later write the scene's initial level (levels.<id>.background.src; "defaultLevel0000" in a new scene). A v14
// scene with no level yet gets one created. Older cores write scene.background.src. The saved value is read back, and a value
// that did not stick is an error instead of a silent grey map. Result: { via: "level"|"scene", levelId, src }.
export async function setSceneBackground(scene, src, g = globalThis.game) {
  if (sceneUsesLevels(scene, g)) {
    const levels = levelList(scene);
    let lvl = scene.initialLevel ?? levels.find(l => l.id === DEFAULT_LEVEL_ID) ?? levels[0] ?? null;
    let created = false;
    if (!lvl) {
      if (typeof scene.createEmbeddedDocuments !== "function") throw new Error("scene has no level to hold the background");
      let made;
      try { made = await scene.createEmbeddedDocuments("Level", [{ _id: DEFAULT_LEVEL_ID, name: "Default", background: { src } }], { keepId: true }); }
      catch { made = await scene.createEmbeddedDocuments("Level", [{ name: "Default", background: { src } }]); }
      lvl = made?.[0] ?? levelList(scene)[0] ?? null; created = true;
      if (!lvl) throw new Error("could not create a level for the background");
    } else if (typeof scene.updateEmbeddedDocuments === "function" && lvl.id) {
      await scene.updateEmbeddedDocuments("Level", [{ _id: lvl.id, background: { src } }]);
    } else if (typeof lvl.update === "function") {
      await lvl.update({ "background.src": src });
    } else throw new Error("level cannot be updated");
    const saved = lvl.background?.src;
    if (saved !== undefined && saved !== src) throw new Error(`level background did not save (${saved ?? "empty"})`);
    return { via: "level", levelId: lvl.id ?? null, src: saved ?? src, ...(created ? { created: true } : {}) };
  }
  await scene.update({ "background.src": src });
  const saved = scene.background?.src;
  if (saved !== undefined && saved !== src) throw new Error(`scene background did not save (${saved ?? "empty"})`);
  return { via: "scene", levelId: null, src: saved ?? src };
}

// Turn a command reply into one readable line, so a bot never posts raw JSON or "[object Object]".
export function formatResult(r) {
  if (r == null) return "";
  if (typeof r !== "object") return String(r);
  if (r.ok === false) return `Error ${r.code ?? ""}: ${r.error ?? "unknown"}`.replace("  ", " ");
  const v = "ok" in r ? r.result : r;
  if (v == null) return "OK";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(x => formatResult(x)).join(", ");
  if (typeof v.summary === "string") return v.summary;
  if (typeof v.report === "string") return v.report;
  return Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "")
    .map(([k, x]) => `${k}: ${typeof x === "object" ? (Array.isArray(x) ? x.map(y => typeof y === "object" ? JSON.stringify(y) : y).join("/") : JSON.stringify(x)) : x}`).join(", ");
}

// 0.8.7: GM text sometimes arrives as a JSON string like {"text":"..."}; unwrap it before display/TTS.
export function unwrapText(v) {
  if (v && typeof v === "object") return String(v.text ?? v.content ?? JSON.stringify(v));
  const t = String(v ?? "").trim();
  if (t.startsWith("{") && t.endsWith("}")) { try { const o = JSON.parse(t); const x = o?.text ?? o?.content; if (typeof x === "string") return x; } catch {} }
  return v ?? "";
}
// 0.8.7: background src for a scene on v14 (levels[0]) or older (scene.background).
export function sceneBackgroundSrc(scene) {
  return scene?.initialLevel?.background?.src || scene?.levels?.contents?.[0]?.background?.src || scene?.background?.src || scene?.img || null;
}
