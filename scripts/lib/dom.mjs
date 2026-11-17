// 0.9.9: safe DOM roots. Foundry hands render hooks a jQuery object (v11/v12 style), an HTMLElement (v13/v14 ApplicationV2) or, when
// the element is missing, nothing. A <form> element also answers html[0] (its first field), so "html?.[0] ?? html" is NOT safe.
// rootOf() returns an Element that really has querySelector, or null; every add-on DOM query goes through it (or through qs / qsa).
export function rootOf(html) {
  try {
    if (!html) return null;
    if (typeof html.querySelector === "function") return html;                       // an Element, Document or ShadowRoot
    const first = html[0] ?? (typeof html.get === "function" ? html.get(0) : null);   // jQuery
    return first && typeof first.querySelector === "function" ? first : null;
  } catch { return null; }
}
export function qs(root, selector) { try { const r = rootOf(root); return r ? r.querySelector(selector) : null; } catch { return null; } }
export function qsa(root, selector) { try { const r = rootOf(root); return r ? Array.from(r.querySelectorAll(selector) ?? []) : []; } catch { return []; } }
