// Named "Your turn" clips: turn-<pc|generic>-<ryan|thomas|sonia|aria>.mp3
// A file with no voice suffix (turn-tempus.mp3) is treated as Ryan.
// The module does not record or synthesize these; the bot uploads them and calls registerTurnClips.
import { resolveTtsVoice, ttsVoiceSlug, TTS_VOICES, DEFAULT_TTS_VOICE } from "./voices.mjs";

export function turnClipSlug(name) {
  const s = String(name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return s || "generic";
}

export function turnClipFile(name, voice) {
  return `turn-${turnClipSlug(name)}-${ttsVoiceSlug(voice)}.mp3`;
}

export function turnClipKey(name, voice) {
  const raw = String(name ?? "");
  const up = raw.startsWith("up:");
  return `${up ? "up:" : ""}${turnClipSlug(up ? raw.slice(3) : raw)}|${resolveTtsVoice(voice)}`;
}

export function parseTurnClipName(file) {
  const base = String(file ?? "").split(/[\\/]/).pop() || "";
  const m = base.match(/turn-([a-z0-9]+)(?:-([a-z0-9]+))?\.mp3$/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const voice = resolveTtsVoice(m[2] || "ryan");
  return { slug, voice, voiceSlug: ttsVoiceSlug(voice), file: base };
}

export class TurnClipStore {
  constructor({ entries = [] } = {}) { this.map = new Map(entries); }
  get(name, voice) { return this.map.get(turnClipKey(name, voice)) ?? null; }
  put(name, voice, path) {
    const k = turnClipKey(name, voice);
    this.map.set(k, String(path));
    return k;
  }
  list() {
    return [...this.map.entries()].map(([k, path]) => {
      const [raw, voice] = k.split("|");
      const up = raw.startsWith(UP_PREFIX); const slug = up ? raw.slice(UP_PREFIX.length) : raw;
      return { kind: up ? "up" : "turn", slug, voice, voiceSlug: ttsVoiceSlug(voice), path, file: up ? upClipFile(slug, voice) : turnClipFile(slug, voice) };
    });
  }
  toJSON() { return [...this.map.entries()]; }
}

// Chosen voice for this PC, then generic in that voice, then this PC in Ryan, then generic Ryan.
export function resolveTurnClip(name, voice, store) {
  if (!store) return null;
  const slug = turnClipSlug(name);
  const chosen = resolveTtsVoice(voice);
  const ryan = DEFAULT_TTS_VOICE;
  return store.get(slug, chosen)
    || store.get("generic", chosen)
    || (chosen !== ryan ? store.get(slug, ryan) : null)
    || store.get("generic", ryan)
    || null;
}

export function turnClipAudioMap(name, store) {
  const out = {};
  for (const v of TTS_VOICES) {
    const src = resolveTurnClip(name, v.id, store);
    if (src) out[ttsVoiceSlug(v.id)] = src;
  }
  return out;
}

// 0.8.20 #5: "<name> is up" clips for ally and enemy turns, recorded the same way as the Your-turn clips:
// up-<name|enemy|ally|generic>-<ryan|thomas|sonia|aria>.mp3, uploaded by the bot and sent to registerTurnClips.
// Lookup per voice: the full name ("lieutenantharrow"), then each word of it ("harrow"), then the side
// (enemy/ally), then generic; each in the chosen voice first, then Ryan. The module ships recorded
// up-enemy / up-ally / up-generic clips for all four voices as the last fallback (no generation in the browser).
export const UP_PREFIX = "up:";
export const BUNDLED_UP_BASE = "modules/ai-gm-bridge/assets/turn-up";
export const BUNDLED_UP_KINDS = ["enemy", "ally", "generic"];
export function parseClipName(file) {
  const base = String(file ?? "").split(/[\\/]/).pop() || "";
  const m = base.match(/(?:^|[-_])(turn|up)-([a-z0-9]+)(?:-([a-z0-9]+))?\.mp3$/i) || base.match(/^(turn|up)-([a-z0-9]+)(?:-([a-z0-9]+))?\.mp3$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const slug = m[2].toLowerCase();
  const voice = resolveTtsVoice(m[3] || "ryan");
  return { kind, slug, voice, voiceSlug: ttsVoiceSlug(voice), file: base };
}
export const upClipFile = (name, voice) => `up-${turnClipSlug(name)}-${ttsVoiceSlug(voice)}.mp3`;
export function nameSlugs(name) {
  const full = turnClipSlug(name);
  const words = String(name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3).map(turnClipSlug);
  return [...new Set([full, ...words].filter(s => s && s !== "generic"))];
}
export function bundledUpClip(kind, voice) {
  const k = BUNDLED_UP_KINDS.includes(kind) ? kind : "generic";
  return `${BUNDLED_UP_BASE}/up-${k}-${ttsVoiceSlug(voice)}.mp3`;
}
export function resolveUpClip(name, voice, store, { side = "enemy", bundled = true } = {}) {
  const chosen = resolveTtsVoice(voice);
  const voices = chosen === DEFAULT_TTS_VOICE ? [chosen] : [chosen, DEFAULT_TTS_VOICE];
  const kind = side === "ally" ? "ally" : side === "enemy" ? "enemy" : "generic";
  const slugs = [...nameSlugs(name), kind, "generic"];
  if (store) for (const slug of slugs) for (const v of voices) { const hit = store.get(UP_PREFIX + slug, v); if (hit) return hit; }
  return bundled ? bundledUpClip(kind, chosen) : null;
}
export function upClipAudioMap(name, store, opts = {}) {
  const out = {};
  for (const v of TTS_VOICES) { const src = resolveUpClip(name, v.id, store, opts); if (src) out[ttsVoiceSlug(v.id)] = src; }
  return out;
}
export const upSpoken = (name) => `${String(name ?? "").trim() || "Next"} is up.`;
