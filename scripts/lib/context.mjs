// v0.7: GM-only context for the bot. Pure helpers (no Foundry globals) so they can be unit tested.
// The text produced here is SECRET (hidden tokens, GM notes). It must only leave the GM client as a command/api return value.
export function stripHtml(html) {
  return String(html ?? "").replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}
export const trunc = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + "…");
// Short stable hash (FNV-1a 32-bit, base36).
export function shortHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
export const parseList = (s) => (Array.isArray(s) ? s : String(s ?? "").split(/[,\n]/)).map(x => String(x).trim()).filter(Boolean);
// Does a journal entry match the include list (entry id/name, or any ancestor folder id/name)?
export function journalIncluded(entry, list) {
  if (!list.length) return false; const L = list.map(x => x.toLowerCase());
  const hit = (d) => d && (L.includes(String(d.id).toLowerCase()) || L.includes(String(d.name ?? "").toLowerCase()));
  if (hit(entry)) return true; for (let f = entry.folder; f; f = f.folder) if (hit(f)) return true; return false;
}
export const TOKEN_DISP = { "-2": "secret", "-1": "hostile", "0": "neutral", "1": "friendly" };
export function tokenStance(token = {}, actor = token?.actor) {
  if (actor?.hasPlayerOwner || token?.hasPlayerOwner || actor?.type === "character") return "pc";
  return TOKEN_DISP[String(token?.disposition)] ?? "";
}
function tokenLine(t) {
  const hp = t.hp ? ` HP ${t.hp.value}${t.hp.max != null ? "/" + t.hp.max : ""}` : "";
  return `${t.name}${t.disposition ? ` (${t.disposition})` : ""}${hp}${t.defeated ? " defeated" : ""}`;
}
// data = { scene:{name, notes}, journals:[{name, pages:[{name, text|html}]}], tokens:[{name, hidden, disposition, hp, defeated}], combat:{round, turn, current, order:[...]}}
export function buildSections(data, { maxChars = 4000 } = {}) {
  const S = {};
  if (data.scene) S.scene = `SCENE: ${data.scene.name}${data.scene.notes ? `\n${trunc(stripHtml(data.scene.notes), Math.floor(maxChars * 0.2))}` : ""}`;
  const toks = data.tokens ?? []; const vis = toks.filter(t => !t.hidden), hid = toks.filter(t => t.hidden);
  if (toks.length) S.tokens = `TOKENS visible: ${vis.map(tokenLine).join("; ") || "none"}\nTOKENS hidden (GM only): ${hid.map(tokenLine).join("; ") || "none"}`;
  if (data.combat) { const c = data.combat; S.combat = `COMBAT round ${c.round} turn ${c.turn ?? 0}: now ${c.current ?? "?"}; order ${(c.order ?? []).join(", ")}`; }
  // One section per journal entry ("journal:<name>") so a change to one entry resends only that entry.
  const js = data.journals ?? [];
  if (js.length) {
    const used = Object.values(S).reduce((n, s) => n + s.length + 1, 0); const per = Math.max(80, Math.floor((maxChars - used - 10) / Math.max(1, js.reduce((n, j) => n + Math.max(1, (j.pages ?? []).length), 0))));
    for (const j of js) S[`journal:${j.name}`] = (j.pages?.length ? j.pages : [{ name: "", text: "" }]).map(p =>
      `JOURNAL [${j.name}${p.name && p.name !== j.name ? " / " + p.name : ""}] ${trunc(stripHtml(p.text ?? p.html ?? ""), per)}`).join("\n");
  }
  return S;
}
const FIXED = ["scene", "combat", "tokens"];
const keysOf = (sections) => [...FIXED.filter(k => sections[k]), ...Object.keys(sections).filter(k => k.startsWith("journal:") && sections[k])];
export function renderContext(sections, maxChars = 4000) { return trunc(keysOf(sections).map(k => sections[k]).join("\n"), maxChars); }
// Cache: remembers section hashes the bot was last given (IN MEMORY ONLY on the GM client; never written to flags, settings or documents).
// Returns only the sections (scene, combat, tokens, each journal) whose hash changed, or unchanged:true.
export class ContextCache {
  constructor() { this.last = null; }
  diff(sections, { maxChars = 4000, since = null, full = false } = {}) {
    const text = renderContext(sections, maxChars); const hash = shortHash(text);
    const sectionHashes = Object.fromEntries(keysOf(sections).map(k => [k, shortHash(sections[k])]));
    const prev = this.last; this.last = { hash, sectionHashes };
    if (!full && since && since === hash) return { hash, unchanged: true };
    if (full || !prev || (since && since !== prev.hash)) return { hash, unchanged: false, full: true, text, sectionHashes };
    if (prev.hash === hash) return { hash, unchanged: true };
    const changed = [...new Set([...Object.keys(sectionHashes), ...Object.keys(prev.sectionHashes)])].filter(k => sectionHashes[k] !== prev.sectionHashes[k]);
    const removed = changed.filter(k => !sections[k]); // removed sections go only in removed (v0.8)
    return { hash, unchanged: false, full: false, changed: changed.filter(k => sections[k]), removed, text: renderContext(Object.fromEntries(changed.filter(k => sections[k]).map(k => [k, sections[k]])), maxChars), sectionHashes };
  }
}
// The permission gate used by both the command and api.context.
export const contextAllowed = (user) => !!user?.isGM;
