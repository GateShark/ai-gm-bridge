// Serial audio queue deduped by id: a clip id is played at most once; clips never overlap.
// A failed play is retried (another sound, e.g. dice, may have collided with it). If the browser blocks
// autoplay (isBlocked(err)), the clip stays at the head, the queue pauses, onBlocked() fires once, and
// unlock() resumes and replays it.
export const isAutoplayBlocked = (e) => e?.name === "NotAllowedError" || e?.blocked === true || /autoplay|user (gesture|interaction)|not allowed/i.test(String(e?.message ?? e));
export class AudioQueue {
  constructor({ play, gapMs = 250, maxSeen = 500, retries = 2, retryDelayMs = 600, isBlocked = isAutoplayBlocked, onBlocked = () => {}, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
    Object.assign(this, { play, gapMs, maxSeen, retries, retryDelayMs, isBlocked, onBlocked, sleep });
    this.q = []; this.seen = new Set(); this.running = false; this.blocked = false;
  }
  // Returns a promise resolving to {id, played:true} when the clip finished, or {duplicate:true} immediately.
  enqueue(id, clip) {
    if (this.seen.has(id)) return Promise.resolve({ id, duplicate: true });
    this.seen.add(id); if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value);
    return new Promise((resolve) => { this.q.push({ id, clip, resolve, tries: 0 }); this._drain(); });
  }
  get length() { return this.q.length; }
  // Call from a user gesture (click) after onBlocked: resumes the queue, replaying the held clip.
  unlock() { if (!this.blocked) return false; this.blocked = false; this._drain(); return true; }
  async _drain() {
    if (this.running || this.blocked) return; this.running = true;
    try {
      while (this.q.length && !this.blocked) {
        const item = this.q[0];
        try { await this.play(item.clip); this.q.shift(); item.resolve({ id: item.id, played: true }); }
        catch (e) {
          if (this.isBlocked(e)) { this.blocked = true; try { this.onBlocked(item); } catch {} break; }
          if (item.tries++ < this.retries) { await this.sleep(this.retryDelayMs * item.tries); continue; }
          this.q.shift(); this.seen.delete(item.id); item.resolve({ id: item.id, played: false, error: String(e?.message ?? e) });
        }
        if (this.q.length) await this.sleep(this.gapMs);
      }
    } finally { this.running = false; }
  }
}
// One-time "click to enable audio" prompt (DOM injected for tests). Click unlocks the queue and removes itself.
export function showAudioUnlockPrompt({ queue, doc = globalThis.document, label = "Click to enable audio", beforeUnlock = async () => {} }) {
  if (!doc?.body || doc.getElementById("aigm-audio-unlock")) return null;
  const b = doc.createElement("button"); b.id = "aigm-audio-unlock"; b.type = "button"; b.textContent = label;
  b.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10000;padding:8px 16px;font-size:16px;cursor:pointer";
  b.addEventListener("click", async () => { try { await beforeUnlock(); } catch {} b.remove(); queue.unlock(); });
  doc.body.appendChild(b); return b;
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

// 0.8.7: any user gesture, or the tab becoming visible again, resumes a blocked queue (no need to hit the button).
export function installAudioResume({ queue, doc = globalThis.document, beforeUnlock = async () => {} }) {
  if (!doc?.addEventListener) return false;
  const go = async () => { if (!queue.blocked && !queue.length) return; try { await beforeUnlock(); } catch {} doc.getElementById?.("aigm-audio-unlock")?.remove?.();
    if (!queue.unlock()) queue._drain(); };
  for (const ev of ["pointerdown", "keydown"]) doc.addEventListener(ev, go, { capture: true });
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") go(); });
  return true;
}
