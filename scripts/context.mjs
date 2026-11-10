// v0.7 GM-only context collector. Reads Foundry documents and returns text to the CALLER ONLY.
// Which journals: only what the caller passes per call (`journals`), so the list never sits in client-synced data.
// Never creates chat messages, never emits on the socket, never renders anything. `g` is the Foundry `game` object
// (injectable for tests).
import { ok, fail } from "./lib/result.mjs";
import { buildSections, ContextCache, parseList, journalIncluded, contextAllowed, tokenStance } from "./lib/context.mjs";
import { readActorHp } from "./lib/hp.mjs";
export const cache = new ContextCache(); // memory only
const find = (coll, key) => key == null ? null : (coll?.get?.(key) ?? coll?.getName?.(key) ?? coll?.find?.(d => d.name?.toLowerCase() === String(key).toLowerCase()) ?? null);
function pagesOf(entry, pageKey) {
  const all = entry?.pages?.contents ?? [];
  const pick = pageKey ? all.filter(p => p.id === pageKey || p.name?.toLowerCase() === pageKey.toLowerCase()) : all;
  return pick.filter(p => (p.type ?? "text") === "text").map(p => ({ name: p.name, html: p.text?.content ?? "" }));
}
export function collectData(g, { scene, journals } = {}) {
  const sc = scene ? find(g.scenes, scene) : (g.scenes?.active ?? g.scenes?.viewed ?? null);
  const data = {};
  if (sc) {
    const notes = [];
    if (sc.journal) notes.push(...pagesOf(sc.journal, sc.journalEntryPage?.id ?? sc.journalEntryPage).map(p => p.html));
    const pins = (sc.notes?.contents ?? []).map(n => n.text || n.entry?.name || n.label).filter(Boolean);
    if (pins.length) notes.push(`Map notes: ${pins.join(", ")}`);
    data.scene = { name: sc.name, notes: notes.join("\n") };
    const hpPath = g.settings?.get?.("ai-gm-bridge", "hpPath");
    data.tokens = (sc.tokens?.contents ?? []).map(t => {
      const hp = readActorHp(t.actor, hpPath);
      return { name: t.name, hidden: !!t.hidden, disposition: tokenStance(t, t.actor),
        hp, defeated: !!t.combatant?.defeated };
    });
  }
  const c = g.combat;
  if (c?.started || c?.round > 0) data.combat = { round: c.round, turn: c.turn, current: c.combatant?.name ?? null,
    order: (c.turns ?? []).map(t => `${t.name}${t.initiative != null ? `(${t.initiative})` : ""}${t.hidden ? "[hidden]" : ""}`) };
  const out = []; const seen = new Set();
  const add = (entry, page) => { if (!entry) return; const k = entry.id + "/" + (page ?? ""); if (seen.has(k)) return; seen.add(k); out.push({ name: entry.name, pages: pagesOf(entry, page) }); };
  if (sc?.journal) seen.add(sc.journal.id + "/" + (sc.journalEntryPage?.id ?? sc.journalEntryPage ?? ""));
  for (const j of parseList(journals)) { const [e, p] = j.split("/"); add(find(g.journal, e.trim()), p?.trim()); }
  // Folder names in `journals` include every entry in that folder (and subfolders).
  const L = parseList(journals).filter(j => !j.includes("/")); if (L.length) for (const e of g.journal?.contents ?? []) if (journalIncluded(e, L)) add(e);
  data.journals = out;
  return data;
}
export function getContext(g, opts = {}) {
  if (!contextAllowed(g.user)) return fail(403, "context is GM-only");
  const maxChars = Math.min(Math.max(Number(opts.maxChars) || 4000, 200), 20000);
  const sections = buildSections(collectData(g, opts), { maxChars });
  return ok(cache.diff(sections, { maxChars, since: opts.since ?? null, full: !!opts.full }));
}
