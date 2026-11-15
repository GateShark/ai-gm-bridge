// 0.9.0 #1: non-currency loot (e.g. "a gold tooth") becomes an item on the character's sheet.
import { parseSilverText } from "./quickgm.mjs";
export const LOOT_ITEM_TYPES = ["misc", "item", "gear", "equipment", "loot"];
const SILVER_RE = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:silver|silvers)\b/i;
const NOTHING_RE = /^(nothing|none|no loot|empty|-+|—)$/i;
// Silver goes to system.silver; whatever text is left (e.g. "and a gold tooth") is an item name.
export function splitLootText(text) {
  const s = String(text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const silver = parseSilverText(s);
  const rest = s.replace(SILVER_RE, " ").replace(/\s+/g, " ").trim();
  return { silver, itemName: cleanLootName(rest) };
}
export function cleanLootName(text) {
  let n = String(text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  n = n.replace(/^(?:[,;+&.:]|\band\b|\bplus\b|\bwith\b)\s*/i, "").replace(/^(?:a|an|one|the|some)\s+/i, "").replace(/[.,;:!]+$/, "").trim();
  if (n.length < 2 || NOTHING_RE.test(n) || /^\d+$/.test(n)) return null;
  return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 80);
}
export function pickLootItemType(available = []) {
  const list = (Array.isArray(available) ? available : Object.keys(available ?? {})).filter(t => t && t !== "base");
  for (const t of LOOT_ITEM_TYPES) if (list.includes(t)) return t;
  return list.find(t => !["class", "background", "feature", "invokable"].includes(t)) || "misc";
}
export function availableItemTypes(g = globalThis.game, cfg = globalThis.CONFIG) {
  const dt = g?.documentTypes?.Item ?? g?.system?.documentTypes?.Item;
  if (Array.isArray(dt) && dt.length) return dt;
  if (dt && typeof dt === "object" && Object.keys(dt).length) return Object.keys(dt);
  const labels = cfg?.Item?.typeLabels; if (labels && Object.keys(labels).length) return Object.keys(labels);
  return [];
}
export function lootItemData(name, { type = "misc", qty = 1, img = null } = {}) {
  const clean = cleanLootName(name) ?? String(name ?? "").trim();
  const q = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
  return { name: clean, type, ...(img ? { img } : {}), system: { quantity: q }, flags: { "ai-gm-bridge": { loot: true } } };
}
// Linked token -> its world actor; unlinked token -> the token's own actor (both are what token.actor returns).
export async function addLootItems(actor, names = [], opts = {}) {
  const list = names.map(n => cleanLootName(n)).filter(Boolean);
  if (!actor || !list.length) return [];
  const type = opts.type || pickLootItemType(availableItemTypes());
  const data = list.map(n => lootItemData(n, { type, qty: opts.qty, img: opts.img }));
  await actor.createEmbeddedDocuments("Item", data);
  return data.map(d => d.name);
}
