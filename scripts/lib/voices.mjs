// Table TTS voice list. Edit only TTS_VOICES to swap who the table can use.
// The module never calls a TTS provider; these ids are what the bot should pass to its own Azure Neural TTS
// and to voiceLookup / postVoice so the clip cache keys match.
export const TTS_VOICES = [
  { id: "en-GB-RyanNeural", name: "Ryan", label: "Ryan (British man)", locale: "en-GB", gender: "male", default: true },
  { id: "en-GB-ThomasNeural", name: "Thomas", label: "Thomas (British man)", locale: "en-GB", gender: "male" },
  { id: "en-GB-SoniaNeural", name: "Sonia", label: "Sonia (British woman)", locale: "en-GB", gender: "female" },
  { id: "en-US-AriaNeural", name: "Aria", label: "Aria (American woman)", locale: "en-US", gender: "female" }
];

export const DEFAULT_TTS_VOICE = TTS_VOICES.find(v => v.default)?.id ?? TTS_VOICES[0]?.id ?? "en-GB-RyanNeural";
export const DEFAULT_TTS_VOICE_SLUG = "ryan";
export const VOICE_PREVIEW_BASE = "modules/ai-gm-bridge/assets/voice-preview";
const ID = "ai-gm-bridge";

export function listTtsVoices() {
  return TTS_VOICES.map(v => ({ ...v, slug: ttsVoiceSlug(v.id), preview: voicePreviewSrc(v.id) }));
}

function norm(s) { return String(s ?? "").trim().toLowerCase(); }

export function findTtsVoice(raw) {
  const key = norm(raw);
  if (!key) return TTS_VOICES.find(v => v.id === DEFAULT_TTS_VOICE) ?? TTS_VOICES[0] ?? null;
  return TTS_VOICES.find(v => {
    const id = norm(v.id), name = norm(v.name), bare = id.replace(/neural$/, "");
    return key === id || key === name || key === bare || key === `${name} neural` || key === norm(v.label);
  }) ?? null;
}

// Empty → default (Ryan). A known name/id → canonical id. Anything else is left as-is so an extra voice is not blocked.
export function resolveTtsVoice(raw) {
  if (raw == null || !String(raw).trim()) return DEFAULT_TTS_VOICE;
  return findTtsVoice(raw)?.id ?? String(raw).trim();
}

export function ttsVoiceSlug(raw) {
  const hit = findTtsVoice(raw);
  if (hit) return hit.name.toLowerCase();
  const s = norm(raw);
  if (!s) return DEFAULT_TTS_VOICE_SLUG;
  return s.replace(/neural$/, "").split("-").pop() || DEFAULT_TTS_VOICE_SLUG;
}

export function voicePreviewSrc(raw) {
  return `${VOICE_PREVIEW_BASE}/voice-${ttsVoiceSlug(raw)}.mp3`;
}

export function readUserVoiceSlug(user, fallback) {
  try {
    const flag = user?.getFlag?.(ID, "gmVoice") ?? user?.flags?.[ID]?.gmVoice;
    if (flag != null && String(flag).trim()) return ttsVoiceSlug(flag);
  } catch {}
  if (fallback != null && String(fallback).trim()) return ttsVoiceSlug(fallback);
  return DEFAULT_TTS_VOICE_SLUG;
}

export function localVoiceSlug(g = globalThis.game) {
  let setting = "";
  try { setting = g?.settings?.get?.(ID, "ttsVoice") ?? ""; } catch {}
  return readUserVoiceSlug(g?.user, setting);
}

// audio is { ryan: path, thomas: path, ... }. Single-path callers pass path only and leave audio empty.
export function normalizeAudioMap(audio, path) {
  const map = {};
  if (audio && typeof audio === "object" && !Array.isArray(audio)) {
    for (const [k, v] of Object.entries(audio)) {
      if (typeof v === "string" && v.trim()) map[ttsVoiceSlug(k)] = v.trim();
    }
  }
  if (!Object.keys(map).length) return null;
  if (typeof path === "string" && path.trim() && !map[DEFAULT_TTS_VOICE_SLUG]) map[DEFAULT_TTS_VOICE_SLUG] = path.trim();
  return map;
}

export function pickAudioSrc(audio, slug, path) {
  const chosen = ttsVoiceSlug(slug || DEFAULT_TTS_VOICE_SLUG);
  if (audio && typeof audio === "object" && !Array.isArray(audio)) {
    const hit = audio[chosen] || audio[DEFAULT_TTS_VOICE_SLUG];
    if (typeof hit === "string" && hit) return hit;
  }
  return (typeof path === "string" && path) ? path : null;
}

// Second AudioHelper argument is always false: play only on this client.
export function playVoicePreview(raw, helper = globalThis.foundry?.audio?.AudioHelper) {
  const src = voicePreviewSrc(raw);
  try { return helper?.play?.({ src, volume: 0.8, autoplay: true, loop: false }, false); } catch { return null; }
}
