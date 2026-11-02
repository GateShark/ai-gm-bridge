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

// v14 keeps the background on the scene's first level; older versions use scene.background.src.
export async function setSceneBackground(scene, src) {
  const lvl = scene.levels?.contents?.[0];
  if (lvl && typeof lvl.update === "function") { await lvl.update({ "background.src": src }); return { via: "level", levelId: lvl.id ?? null, src: lvl.background?.src ?? src }; }
  await scene.update({ "background.src": src }); return { via: "scene", levelId: null, src: scene.background?.src ?? src };
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
