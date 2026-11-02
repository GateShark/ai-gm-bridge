// Session log (pure): diff actors into compact lines, format/parse journal lines, recap.
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
export const TRACKED = { hp: "system.attributes.hp.value", luck: "system.attributes.luck.value", rituals: "system.attributes.rituals.value", extra: "system.attributes.extraResource.value" };
export function actorChanges(name, before, change, { extraLabel = "", hpPath } = {}) {
  const out = []; const paths = { ...TRACKED, ...(hpPath ? { hp: hpPath } : {}) };
  for (const [k, p] of Object.entries(paths)) {
    const nv = get(change, p) ?? change?.[p]; if (nv === undefined) continue;
    const ov = get(before, p); if (ov === nv || typeof nv !== "number") continue;
    const label = k === "extra" ? (extraLabel || "extra resource") : k === "luck" ? "Devil's Luck" : k;
    if (k === "hp") { out.push({ kind: nv < ov ? "damage" : "heal", text: `${name} HP ${ov}→${nv} (${nv - ov > 0 ? "+" : ""}${nv - ov})` });
      if (nv <= 0 && ov > 0) out.push({ kind: "death", text: `${name} dropped to 0 HP` }); }
    else out.push({ kind: nv < ov ? "spent" : "gained", text: `${name} ${label} ${ov}→${nv}` });
  }
  return out;
}
const pad = (n) => String(n).padStart(2, "0");
export const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
export const lineHtml = (at, kind, text) => `<p data-t="${at}" data-k="${kind}">[${stamp(at)}] ${esc(text)}</p>`;
export function parseLines(html) {
  const out = []; const re = /<p data-t="(\d+)" data-k="([a-z]+)">\[[^\]]*\] ([\s\S]*?)<\/p>/g; let m;
  while ((m = re.exec(String(html ?? "")))) out.push({ at: Number(m[1]), kind: m[2], text: m[3].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") });
  return out;
}
export function recap(lines, { since = 0, max = 40 } = {}) {
  const s = typeof since === "string" ? Date.parse(since) : since; const L = lines.filter(l => l.at >= (s || 0));
  const counts = {}; for (const l of L) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const key = L.filter(l => ["death", "combat", "item"].includes(l.kind));
  const rest = L.filter(l => !key.includes(l));
  const pick = [...key, ...rest.slice(-Math.max(0, max - key.length))].sort((a, b) => a.at - b.at).slice(-max);
  return { since: s || 0, count: L.length, counts, lines: pick.map(l => `[${stamp(l.at).slice(11)}] ${l.text}`),
    summary: Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing logged" };
}
