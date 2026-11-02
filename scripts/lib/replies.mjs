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
