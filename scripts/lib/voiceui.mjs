// 0.8.8 chat polish: replay button on GM voice lines, collapse long lines.
import { pickAudioSrc, localVoiceSlug } from "./voices.mjs";
export const VOICE_COLLAPSE_CHARS = 280;
const defaultEsc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function extractVoiceSrc(html) {
  const m = String(html ?? "").match(/<audio[^>]*\ssrc=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export function plainVoiceText(content) {
  return String(content ?? "").replace(/<audio[\s\S]*?<\/audio>/gi, "").replace(/<[^>]+>/g, "").trim();
}

export function shouldCollapse(text, limit = VOICE_COLLAPSE_CHARS) {
  return String(text ?? "").length > limit;
}

export function collapseParts(text, limit = VOICE_COLLAPSE_CHARS) {
  const full = String(text ?? "");
  if (full.length <= limit) return { collapsed: false, short: full, full };
  return { collapsed: true, short: `${full.slice(0, limit)}…`, full };
}

export function replayId(src, now = Date.now()) {
  return `replay:${src}:${now}`;
}

// 0.8.20 #6: which file the ▶ button plays, decided at click time so a voice change applies at once:
// the message's per-voice map in the player's voice, then the shared voice cache for this text in that voice,
// then the map's Ryan entry, then the file in the message.
export function replaySrc(msg, { slug = localVoiceSlug(), fallback = null, cacheLookup = null } = {}) {
  const map = msg?.flags?.["ai-gm-bridge"]?.audio;
  const own = map && typeof map === "object" ? map[slug] : null;
  if (typeof own === "string" && own) return own;
  if (typeof cacheLookup === "function") { try { const hit = cacheLookup(plainVoiceText(msg?.content), slug); if (hit) return hit; } catch {} }
  return pickAudioSrc(map, slug, fallback) || fallback || null;
}
// Hide the browser's own player (its seek bar played the GM-side file, usually Ryan). Works on old messages too.
export function hideNativeAudio(audio) {
  if (!audio) return false;
  try { audio.removeAttribute?.("controls"); } catch {}
  try { audio.controls = false; } catch {}
  try { audio.hidden = true; } catch {}
  try { audio.setAttribute?.("hidden", ""); } catch {}
  try { audio.pause?.(); } catch {}
  return true;
}
export function enhanceVoiceMessage(msg, html, { t = (k, f) => f || k, replay, collapseAt = VOICE_COLLAPSE_CHARS, esc = defaultEsc, cacheLookup = null, slug = null } = {}) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return false;
  const audio = root.querySelector("audio[src]");
  if (!audio) return false;
  hideNativeAudio(audio);
  if (root.querySelector("[data-aigm-replay]")) return false;
  const fallback = audio.getAttribute("src") || extractVoiceSrc(msg?.content);
  const pick = () => replaySrc(msg, { slug: slug ?? localVoiceSlug(), fallback, cacheLookup });
  const src = pick();
  if (!src) return false;
  const doc = root.ownerDocument ?? globalThis.document;
  const btn = doc.createElement("button");
  btn.type = "button"; btn.className = "aigm-voice-replay"; btn.dataset.aigmReplay = src;
  btn.title = t("AIGM.voice.replay", "Replay"); btn.textContent = "▶";
  btn.setAttribute("aria-label", t("AIGM.voice.replay", "Replay"));
  const spoken = plainVoiceText(msg?.content ?? root.textContent);
  // 0.8.21: grey the ▶ button out while this line is queued or playing, so extra clicks cannot stack.
  btn.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    const done = () => { try { btn.disabled = false; } catch {} };
    try {
      const r = replay?.(pick() || src, { text: spoken, messageId: msg?.id });
      Promise.resolve(r).then(done, done);
    } catch { done(); }
  });
  audio.parentNode?.insertBefore(btn, audio);
  const text = plainVoiceText(msg?.content ?? root.textContent);
  const parts = collapseParts(text, collapseAt);
  if (parts.collapsed) {
    const walker = [];
    for (const node of Array.from(audio.parentNode?.childNodes ?? [])) {
      if (node === audio || node === btn) continue;
      if (node.nodeType === 3 || node.nodeName === "#text") walker.push(node);
    }
    const target = walker[0];
    if (target && (target.textContent || "").trim().length > collapseAt) {
      const wrap = doc.createElement("span");
      wrap.className = "aigm-voice-long";
      wrap.innerHTML = `<span class="aigm-voice-short">${esc(parts.short)} </span><span class="aigm-voice-full" hidden>${esc(parts.full)}</span> ` +
        `<button type="button" class="aigm-voice-more" data-aigm-more>${esc(t("AIGM.voice.more", "Show more"))}</button>`;
      const more = wrap.querySelector("[data-aigm-more]");
      more.addEventListener("click", (ev) => {
        ev.preventDefault();
        const open = wrap.classList.toggle("is-open");
        wrap.querySelector(".aigm-voice-short").hidden = open;
        wrap.querySelector(".aigm-voice-full").hidden = !open;
        more.textContent = open ? t("AIGM.voice.less", "Show less") : t("AIGM.voice.more", "Show more");
      });
      target.parentNode?.replaceChild(wrap, target);
    }
  }
  return true;
}
