// Pure helpers for reply dedupe and leader catch-up, both backed by the persisted DedupeStore.
export const replyKey = (replyTo) => `reply:${replyTo}`;
// Returns the existing reply messageId if a reply to replyTo was already posted (and allowMultiple is false), else null.
export function priorReply(store, replyTo, allowMultiple = false) {
  if (!replyTo || allowMultiple) return null;
  return store.get(replyKey(replyTo))?.messageId ?? null;
}
export function recordReply(store, replyTo, messageId, now) {
  if (replyTo) store.mark(replyKey(replyTo), "acked", now, { messageId });
}
// New-leader catch-up: messages in the window (or last maxN) not yet seen by the dedupe store.
export function missedMessages(messages, store, now, { windowMs = 120000, maxN = 50 } = {}) {
  return messages.filter(m => m && m.id && (m.timestamp ?? 0) >= now - windowMs).slice(-maxN)
    .filter(m => !store.has(`chat:${m.id}`));
}

export const REPLY_LOCK_MS = 180000;
export function resolveReplyTo(explicit, lastWake = null, now = Date.now(), windowMs = REPLY_LOCK_MS) {
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const id = lastWake?.eventIds?.[0];
  if (id && Number(lastWake?.at || 0) > 0 && now - Number(lastWake.at) < windowMs) return String(id);
  return null;
}
export const rollReplyKey = (replyTo) => `roll:${replyTo}`;
export function priorRollReply(store, replyTo) {
  if (!replyTo || !store) return null;
  return store.get(rollReplyKey(replyTo)) ?? null;
}
export function recordRollReply(store, replyTo, requestId, messageId, now) {
  if (replyTo && store) store.mark(rollReplyKey(replyTo), "acked", now, { requestId, messageId });
}

// 0.8.20 #1/#9: the reply lock only applies to an explicit replyTo. A replyTo inferred from the last wake
// (lastWake) is a guess, so it never blocks a different line: it only stops the exact same text from being
// posted twice inside INFERRED_REPEAT_MS (a retried command). The audio-queue id is the new message id, never replyTo. Out-of-character lines never use or take a lock,
// so an OOC aside cannot use up the reply slot of a pending roll or player message.
export const INFERRED_REPEAT_MS = 20000; // GM suggestion: exact repeats within ~20 s only
export function resolveReplyInfo(explicit, lastWake = null, now = Date.now(), windowMs = REPLY_LOCK_MS) {
  if (explicit != null && String(explicit).trim()) return { replyTo: String(explicit).trim(), inferred: false };
  const id = resolveReplyTo(null, lastWake, now, windowMs);
  return id ? { replyTo: id, inferred: true } : { replyTo: null, inferred: false };
}
const OOC_RE = /^\s*(?:<[^>]+>\s*)*(?:\(\(|\[ooc\]|ooc\s*[:\-–]|\(ooc\)|ooc\b)/i;
export function isOocText(content) { return OOC_RE.test(String(content ?? "")); }
export const textKey = (content) => String(content ?? "").replace(/<audio[\s\S]*?<\/audio>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export const sayKey = (replyTo, content, hash) => `say:${replyTo || "-"}:${hash(textKey(content))}`;
// Decide whether a GM line is a repeat. Returns { duplicate:false } or { duplicate:true, messageId }.
//   explicit replyTo (not OOC, allowMultiple false): one reply per event (0.8.17 rule).
//   inferred replyTo or none: only identical text within INFERRED_REPEAT_MS is a repeat.
export function replyGate(store, { replyTo, inferred = false, content = "", ooc = false, allowMultiple = false, now = Date.now(), hash }) {
  if (!store) return { duplicate: false };
  if (replyTo && !inferred && !ooc && !allowMultiple) {
    const prev = priorReply(store, replyTo);
    if (prev) return { duplicate: true, messageId: prev, reason: "replyTo" };
  }
  if (hash && textKey(content)) {
    const e = store.get(sayKey(replyTo, content, hash));
    if (e?.messageId && now - Number(e.t || 0) < INFERRED_REPEAT_MS) return { duplicate: true, messageId: e.messageId, reason: "sameText" };
  }
  return { duplicate: false };
}
export function recordGmLine(store, { replyTo, inferred = false, content = "", ooc = false, messageId, now = Date.now(), hash }) {
  if (!store || !messageId) return;
  if (replyTo && !inferred && !ooc) recordReply(store, replyTo, messageId, now);
  if (hash && textKey(content)) store.mark(sayKey(replyTo, content, hash), "acked", now, { messageId });
}
