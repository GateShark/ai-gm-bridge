// Serial audio queue deduped by id: a clip id is played at most once; clips never overlap.
export class AudioQueue {
  constructor({ play, gapMs = 250, maxSeen = 500, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
    Object.assign(this, { play, gapMs, maxSeen, sleep }); this.q = []; this.seen = new Set(); this.running = false;
  }
  // Returns a promise resolving to {id, played:true} when the clip finished, or {duplicate:true} immediately.
  enqueue(id, clip) {
    if (this.seen.has(id)) return Promise.resolve({ id, duplicate: true });
    this.seen.add(id); if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value);
    return new Promise((resolve) => { this.q.push({ id, clip, resolve }); this._drain(); });
  }
  get length() { return this.q.length; }
  async _drain() {
    if (this.running) return; this.running = true;
    try {
      while (this.q.length) {
        const { id, clip, resolve } = this.q.shift();
        try { await this.play(clip); resolve({ id, played: true }); }
        catch (e) { this.seen.delete(id); resolve({ id, played: false, error: String(e?.message ?? e) }); }
        if (this.q.length) await this.sleep(this.gapMs);
      }
    } finally { this.running = false; }
  }
}
// Voice-with-fallback orchestration (pure; Foundry calls injected). Text is posted if voice fails at any step.
export async function voiceOrText({ audioPath, checkAudio, playVoice, postText, postVoice }) {
  if (audioPath) {
    try {
      if (!(await checkAudio(audioPath))) throw new Error("audio not reachable");
      const msg = await postVoice(audioPath);
      playVoice(audioPath).catch(() => {}); // don't block the reply on playback
      return { mode: "voice", messageId: msg };
    } catch (e) { return { mode: "text", fallback: String(e?.message ?? e), messageId: await postText() }; }
  }
  return { mode: "text", messageId: await postText() };
}
