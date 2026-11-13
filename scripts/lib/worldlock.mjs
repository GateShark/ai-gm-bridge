// 0.8.20 #10: one write queue per world for scene and token changes. Two map builds (or a build and a retry)
// run one after the other instead of interleaving, so they cannot swap a background or add the same token twice.
// buildKey makes a scene build idempotent: a second build with the same key returns the first scene untouched.
import { KeyedMutex } from "./mutex.mjs";
export const worldWrites = new KeyedMutex();
export const worldKey = (g = globalThis.game) => `world:${g?.world?.id ?? "local"}`;
export function withWorldLock(fn, g = globalThis.game) { return worldWrites.run(worldKey(g), fn); }
export function findBuiltScene(scenes, buildKey) {
  if (!buildKey) return null;
  const list = Array.isArray(scenes) ? scenes : (scenes?.contents ?? (scenes ? [...scenes] : []));
  return list.find(s => (s?.getFlag?.("ai-gm-bridge", "buildKey") ?? s?.flags?.["ai-gm-bridge"]?.buildKey) === buildKey) ?? null;
}
// unique spawn: the scene already has a token for this actor (linked, or unlinked with the same base actor).
export function existingActorToken(tokens, actorId) {
  if (!actorId) return null;
  const list = Array.isArray(tokens) ? tokens : (tokens?.contents ?? (tokens ? [...tokens] : []));
  return list.find(t => (t?.actorId ?? t?.actor?.id) === actorId) ?? null;
}
