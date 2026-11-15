// 0.9.0 #2: Devil's Luck tracker on the character sheet. Spending goes through the same setResource path as !luck.
export const LUCK_PATH = "system.attributes.luck";
export function luckOf(actor) {
  if (!actor || actor.type !== "character") return null;
  const v = Number(actor.system?.attributes?.luck?.value);
  return Number.isFinite(v) ? v : 0;
}
export function planSpend(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return { error: "no Devil's Luck left to spend" };
  return { before: v, after: v - 1 };
}
export const spendLuckLine = (name, before, after) => `${name} spends a Devil's Luck (${before} → ${after}).`;
// 0.9.1 #2: where the bar goes. Pirate Borg (v1 sheet): <form> > header.sheet-header, nav.sheet-tabs, section.sheet-body.
// The bar sits right under the sheet header (above the tabs), never as a flex child of .window-content where it would grow.
export function luckBarSpot(root) {
  if (!root?.querySelector) return null;
  const isForm = String(root.nodeName ?? "").toUpperCase() === "FORM";
  const form = isForm ? root : (root.querySelector(".window-content form") ?? root.querySelector("form"));
  if (form) {
    const kids = [...(form.children ?? form.childNodes ?? [])].filter(n => n?.nodeType === 1);
    const cls = (n) => String(n.className ?? "").split(/\s+/);
    const tabs = kids.find(n => cls(n).includes("sheet-tabs") || cls(n).includes("tabs") || String(n.nodeName).toUpperCase() === "NAV");
    if (tabs) return { parent: form, before: tabs };
    const head = kids.find(n => cls(n).includes("sheet-header") || String(n.nodeName).toUpperCase() === "HEADER");
    if (head) return { parent: form, before: head.nextSibling ?? null };
    return { parent: form, before: form.firstChild ?? null };
  }
  const wc = root.querySelector(".window-content") ?? root;
  return { parent: wc, before: wc.firstChild ?? null };
}
// Compact single row: never grows, never shrinks the sheet (flex:0 0 auto even if it lands in a column flex).
export const LUCK_BAR_STYLE = "display:flex;flex:0 0 auto;flex-grow:0;align-self:stretch;gap:6px;align-items:center;height:auto;min-height:0;max-height:26px;margin:2px 0;padding:1px 6px;font-size:12px;line-height:18px;overflow:hidden;box-sizing:border-box";
// Adds (or refreshes) a small "Devil's Luck N [Spend]" row under the sheet header. onSpend returns a promise.
export function injectLuckTracker(root, { actor, canSpend = false, onSpend = null, t = (k, f) => f || k, doc = root?.ownerDocument ?? globalThis.document } = {}) {
  const value = luckOf(actor);
  if (value == null || !root?.querySelector || !doc?.createElement) return null;
  let bar = root.querySelector("[data-aigm-luck]");
  if (!bar) {
    bar = doc.createElement("div"); bar.className = "aigm-luck"; bar.dataset.aigmLuck = actor.id ?? "";
    bar.style.cssText = LUCK_BAR_STYLE;
    const label = doc.createElement("span"); label.className = "aigm-luck-label"; label.textContent = t("AIGM.luck.label", "Devil's Luck");
    const val = doc.createElement("b"); val.className = "aigm-luck-value";
    const btn = doc.createElement("button"); btn.type = "button"; btn.className = "aigm-luck-spend"; btn.textContent = t("AIGM.luck.spend", "Spend");
    btn.style.cssText = "flex:0 0 auto;width:auto;height:18px;line-height:16px;padding:0 6px;margin:0";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault?.(); ev.stopPropagation?.();
      if (btn.disabled || !onSpend) return;
      btn.disabled = true; // one spend per click; re-enabled from the refreshed value
      const done = () => { try { const v = luckOf(actor); val.textContent = String(v ?? 0); btn.disabled = !canSpend || !(v > 0); } catch {} };
      try { Promise.resolve(onSpend(actor)).then(done, done); } catch { done(); }
    });
    bar.append(label, val, btn);
    const spot = luckBarSpot(root) ?? { parent: root, before: root.firstChild ?? null };
    if (spot.parent.insertBefore) spot.parent.insertBefore(bar, spot.before ?? null); else spot.parent.appendChild(bar);
  }
  bar.querySelector(".aigm-luck-value").textContent = String(value);
  bar.querySelector(".aigm-luck-spend").disabled = !canSpend || !(value > 0);
  return bar;
}
