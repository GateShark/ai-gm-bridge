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
