// 0.8.8 chat polish: replay button on GM voice lines, collapse long lines.
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

export function enhanceVoiceMessage(msg, html, { t = (k, f) => f || k, replay, collapseAt = VOICE_COLLAPSE_CHARS, esc = defaultEsc } = {}) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return false;
  const audio = root.querySelector("audio[src]");
  if (!audio) return false;
  if (root.querySelector("[data-aigm-replay]")) return false;
  const src = audio.getAttribute("src") || extractVoiceSrc(msg?.content);
  if (!src) return false;
  const doc = root.ownerDocument ?? globalThis.document;
  const btn = doc.createElement("button");
  btn.type = "button"; btn.className = "aigm-voice-replay"; btn.dataset.aigmReplay = src;
  btn.title = t("AIGM.voice.replay", "Replay"); btn.textContent = "▶";
  btn.setAttribute("aria-label", t("AIGM.voice.replay", "Replay"));
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); replay?.(src); });
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
