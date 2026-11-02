// Voice clip cache by text hash: a reply already voiced reuses its mp3 (no new TTS). Short replies can skip TTS entirely.
import { hashStr } from "./outbox.mjs";
export const voiceKey = (text, voice = "") => hashStr(`${voice}|${String(text).replace(/\s+/g, " ").trim().toLowerCase()}`);
export class VoiceCache {
  constructor({ entries = [], max = 300 } = {}) { this.map = new Map(entries); this.max = max; }
  get(text, voice) { const k = voiceKey(text, voice); const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v ?? null; }
  put(text, path, voice) { const k = voiceKey(text, voice); this.map.delete(k); this.map.set(k, path); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); return k; }
  toJSON() { return [...this.map.entries()]; }
}
export const shouldSkipTts = (text, minChars) => minChars > 0 && String(text).replace(/<[^>]+>/g, "").trim().length < minChars;
