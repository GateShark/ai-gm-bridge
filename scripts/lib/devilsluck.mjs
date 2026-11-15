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
// Adds (or refreshes) a small "Devil's Luck N [Spend]" bar at the top of the sheet. onSpend returns a promise.
export function injectLuckTracker(root, { actor, canSpend = false, onSpend = null, t = (k, f) => f || k, doc = root?.ownerDocument ?? globalThis.document } = {}) {
  const value = luckOf(actor);
  if (value == null || !root?.querySelector || !doc?.createElement) return null;
  let bar = root.querySelector("[data-aigm-luck]");
  if (!bar) {
    bar = doc.createElement("div"); bar.className = "aigm-luck"; bar.dataset.aigmLuck = actor.id ?? "";
    bar.style.cssText = "display:flex;gap:6px;align-items:center;padding:2px 6px;font-size:12px";
    const label = doc.createElement("span"); label.className = "aigm-luck-label"; label.textContent = t("AIGM.luck.label", "Devil's Luck");
    const val = doc.createElement("b"); val.className = "aigm-luck-value";
    const btn = doc.createElement("button"); btn.type = "button"; btn.className = "aigm-luck-spend"; btn.textContent = t("AIGM.luck.spend", "Spend");
    btn.style.cssText = "flex:0 0 auto;width:auto;line-height:16px;padding:0 6px";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault?.(); ev.stopPropagation?.();
      if (btn.disabled || !onSpend) return;
      btn.disabled = true; // one spend per click; re-enabled from the refreshed value
      const done = () => { try { const v = luckOf(actor); val.textContent = String(v ?? 0); btn.disabled = !canSpend || !(v > 0); } catch {} };
      try { Promise.resolve(onSpend(actor)).then(done, done); } catch { done(); }
    });
    bar.append(label, val, btn);
    const host = root.querySelector(".window-content form, form, .window-content") ?? root;
    host.insertBefore?.(bar, host.firstChild ?? null) ?? host.appendChild(bar);
  }
  bar.querySelector(".aigm-luck-value").textContent = String(value);
  bar.querySelector(".aigm-luck-spend").disabled = !canSpend || !(value > 0);
  return bar;
}
