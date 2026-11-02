// Compact payloads: strip HTML, trim text, drop null/undefined/"" fields only, and send context only when it changed.
export const stripHtml = (s) => String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").trim();
export function trimText(s, max = 400) { s = stripHtml(s); return s.length > max ? s.slice(0, max - 1) + "…" : s; }
// Drops only null, undefined and "": false, 0 and [] are kept (rollResult success:false, natural 0, round 0...).
export function prune(o) {
  if (Array.isArray(o)) return o.map(prune);
  if (!o || typeof o !== "object") return o;
  const r = {}; for (const [k, v] of Object.entries(o)) { if (v === null || v === undefined || v === "") continue; r[k] = prune(v); } return r;
}
// Shallow-by-key diff of context objects: only changed keys (null for removed).
export function diff(prev = {}, next = {}) {
  const d = {}; for (const k of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) if (JSON.stringify(prev?.[k]) !== JSON.stringify(next?.[k])) d[k] = next?.[k] ?? null;
  return Object.keys(d).length ? d : null;
}
export function compactEvent(ev, { maxChars = 400 } = {}) {
  const { combat, ...rest } = ev; // combat moves to batch-level ctx diff
  return prune({ ...rest, text: ev.text !== undefined ? trimText(ev.text, maxChars) : undefined, whisper: ev.whisper?.length ? ev.whisper : undefined });
}
export function buildPayload(batch, { ctx, prevCtx, maxChars, hints } = {}) {
  return prune({ batchId: batch.batchId, world: batch.world, seq: batch.seq, attempt: batch.attempt > 1 ? batch.attempt : undefined,
    ctx: diff(prevCtx, ctx), hints, events: batch.events.map(e => compactEvent(e, { maxChars })) });
}
