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
  return `${turnClipSlug(name)}|${resolveTtsVoice(voice)}`;
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
      const [slug, voice] = k.split("|");
      return { slug, voice, voiceSlug: ttsVoiceSlug(voice), path, file: turnClipFile(slug, voice) };
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
