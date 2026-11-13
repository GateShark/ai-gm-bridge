// Large on-screen captions for the current spoken GM line (recorded clips only).
const EL_ID = "aigm-voice-caption";
const ID = "ai-gm-bridge";

export function captionText(raw) {
  return String(raw ?? "").replace(/<audio[\s\S]*?<\/audio>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function captionsEnabled(g = globalThis.game) {
  try { return g?.settings?.get?.(ID, "voiceCaptions") === true; } catch { return false; }
}

export function showVoiceCaption(raw, { doc = globalThis.document, enabled = captionsEnabled() } = {}) {
  const text = captionText(raw);
  if (!enabled || !text || !doc?.body) return null;
  let el = doc.getElementById(EL_ID);
  if (!el) {
    el = doc.createElement("div");
    el.id = EL_ID;
    el.setAttribute("aria-live", "polite");
    doc.body.appendChild(el);
  }
  el.textContent = text;
  applyCaptionFont(el);
  el.hidden = false;
  return el;
}

export function hideVoiceCaption(doc = globalThis.document) {
  const el = doc?.getElementById?.(EL_ID);
  if (!el) return false;
  el.textContent = "";
  el.hidden = true;
  return true;
}

// 0.8.20 #7: per-player caption font (client setting captionFont). Only fonts Foundry or the game system
// already ship are offered (CONFIG.fontDefinitions and fonts the page already declares); nothing is downloaded
// from the internet. "" = the module default.
export const CAPTION_FONT_DEFAULT = "";
export const GENERIC_FONTS = ["serif", "sans-serif", "monospace"];
const ICON_FONT_RE = /awesome|icon|glyph|symbol|emoji/i;
export function safeFontName(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 60 || !/^[A-Za-z0-9 _.\-]+$/.test(s)) return "";
  return s;
}
export function cssFontFamily(name) {
  const s = safeFontName(name);
  if (!s) return "";
  if (GENERIC_FONTS.includes(s.toLowerCase())) return s.toLowerCase();
  return `"${s}", sans-serif`;
}
export function availableCaptionFonts({ config = globalThis.CONFIG, doc = globalThis.document } = {}) {
  const out = new Set();
  try { for (const k of Object.keys(config?.fontDefinitions ?? {})) out.add(k); } catch {}
  try { if (config?.defaultFontFamily) out.add(String(config.defaultFontFamily)); } catch {}
  try { for (const f of doc?.fonts ?? []) if (f?.family) out.add(String(f.family).replace(/^["']|["']$/g, "")); } catch {}
  const names = [...out].map(safeFontName).filter(n => n && !ICON_FONT_RE.test(n) && !GENERIC_FONTS.includes(n.toLowerCase()));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).concat(GENERIC_FONTS);
}
export function captionFontChoices(fonts, defaultLabel = "Default") {
  const choices = { [CAPTION_FONT_DEFAULT]: defaultLabel };
  for (const f of fonts ?? []) choices[f] = f;
  return choices;
}
export function readCaptionFont(g = globalThis.game) {
  try { return safeFontName(g?.settings?.get?.(ID, "captionFont")); } catch { return ""; }
}
export function applyCaptionFont(el, name = readCaptionFont()) {
  if (!el?.style) return "";
  const css = cssFontFamily(name);
  el.style.fontFamily = css;
  return css;
}
// Live preview under the dropdown in Foundry's settings window (and the GM config form).
export const CAPTION_PREVIEW_TEXT = "The sea devil rises from the surf.";
export function attachCaptionFontPreview(root, { selector = `select[name="${ID}.captionFont"]`, text = CAPTION_PREVIEW_TEXT, doc = root?.ownerDocument ?? globalThis.document } = {}) {
  const sel = root?.querySelector?.(selector);
  if (!sel || !doc?.createElement) return null;
  let prev = sel.parentNode?.querySelector?.("[data-aigm-font-preview]");
  if (!prev) {
    prev = doc.createElement("div");
    prev.dataset.aigmFontPreview = "1";
    prev.className = "aigm-font-preview";
    prev.textContent = text;
    sel.parentNode?.appendChild?.(prev);
  }
  const paint = () => applyCaptionFont(prev, sel.value);
  sel.addEventListener?.("change", paint); sel.addEventListener?.("input", paint);
  paint();
  return prev;
}
