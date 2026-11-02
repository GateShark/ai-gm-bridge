// Pure, configurable event filter: should this chat message wake the GM bot? Returns {wake, reason, urgent}.
export const DEFAULT_WAKE_ON = ["mention", "whisper", "keyword", "question", "ic"];
export function classify(msg, opts = {}) {
  const { botUserId, keywords = [], gmNames = ["gm", "ai gm"], wakeOn = DEFAULT_WAKE_ON, ignoreOOC = true, ignorePlainRolls = true,
    ignoreUsers = [], minChars = 1 } = opts;
  if (!msg || !msg.text && !msg.rolls?.length) return { wake: false, reason: "empty" };
  if (msg.authorId && msg.authorId === botUserId) return { wake: false, reason: "bot" };
  if (ignoreUsers.some(u => u && (u === msg.authorId || u.toLowerCase() === msg.author?.toLowerCase()))) return { wake: false, reason: "ignoredUser" };
  const text = (msg.text || "").trim(); const lower = text.toLowerCase(); const on = new Set(wakeOn);
  if (ignoreOOC && (/^\(\(.*\)\)$/s.test(text) || /^(ooc\b|\/\/)/i.test(text))) return { wake: false, reason: "ooc" };
  if (on.has("mention") && gmNames.some(n => new RegExp(`(^|\\W)@?${n}(\\W|$)`, "i").test(lower))) return { wake: true, reason: "mention", urgent: true };
  if (on.has("whisper") && msg.whisperToBot) return { wake: true, reason: "whisper", urgent: true };
  if (on.has("keyword") && keywords.some(k => k && lower.includes(k.toLowerCase()))) return { wake: true, reason: "keyword" };
  if (msg.rolls?.length && !text.includes("?")) return ignorePlainRolls ? { wake: false, reason: "plainRoll" } : { wake: true, reason: "roll" };
  if (text.length < minChars) return { wake: false, reason: "short" };
  if (on.has("ic") && msg.inCharacter) return { wake: true, reason: "ic" };
  if (on.has("question") && text.includes("?")) return { wake: true, reason: "question" };
  return { wake: false, reason: "noTrigger" };
}
export const shouldWake = (msg, opts) => classify(msg, opts).wake;
