// 0.8.8 settings layout: a short Basic page plus a collapsed Advanced list.
// Keys and defaults stay the same so existing worlds keep working. Internal
// state is never shown in the form.
export const HIDDEN_KEYS = ["dedupeState", "outboxState", "voiceCache", "contextJournals", "pushToTalkNoticeShown", "pttPosition", "linkProbe", "sessionSnapshot", "presenceSuspendUntil"];
// Shown on the Basic page (plus the bot-user dropdown and webhook secret).
export const BASIC_KEYS = ["enabled", "botUserId", "delivery", "webhookUrl", "webhookSecret", "alwaysVoiceUsers", "pushToTalkKey", "combatEvents"];
export const BASIC_FIELDS = [
  ["enabled", "checkbox"],
  ["delivery", "select", ["relay", "direct"]],
  ["webhookUrl", "text"],
  ["alwaysVoiceUsers", "text"],
  ["pushToTalkKey", "text"],
  ["combatEvents", "checkbox"],
];
export const ADVANCED_FIELDS = [
  ["botUserName", "text"],
  ["botNames", "text"],
  ["webhookAuthHeader", "text"],
  ["wakeOn", "text"],
  ["keywords", "text"],
  ["ignoreUsers", "text"],
  ["ignoreOOC", "checkbox"],
  ["ignorePlainRolls", "checkbox"],
  ["minChars", "number"],
  ["debounceMs", "number"],
  ["maxWaitMs", "number"],
  ["heartbeatMs", "number"],
  ["heartbeatTimeoutMs", "number"],
  ["offlineAfterMs", "number"],
  ["batchMs", "number"],
  ["localCommands", "checkbox"],
  ["localPrefix", "text"],
  ["ttsMinChars", "number"],
  ["maxTextChars", "number"],
  ["unpauseOnStart", "checkbox"],
  ["hpPath", "text"],
  ["uploadsEnabled", "checkbox"],
  ["uploadMaxMB", "number"],
  ["uploadTypes", "text"],
  ["speakerAlias", "text"],
  ["rollRequestTimeoutMs", "number"],
  ["rollRequestExpireMs", "number"],
  ["rollAnswerNote", "checkbox"],
  ["turnPrompts", "checkbox"],
  ["turnWake", "checkbox"],
  ["turnVoiceUsers", "text"],
  ["voiceTurnPrompt", "checkbox"],
  ["speechHints", "text"],
  ["speechFixes", "text"],
  ["sessionLog", "checkbox"],
  ["ramUsesArmor", "checkbox"],
  ["thinkingIndicator", "checkbox"],
  ["thinkingTimeoutMs", "number"],
  ["metricsLogEvery", "number"],
];
export const ADVANCED_KEYS = ADVANCED_FIELDS.map(f => f[0]);
export const CLIENT_KEYS = ["pushToTalk", "pushToTalkKey", "pushToTalkNoticeShown", "pttPosition"];
// Runtime control used by the GM panel; not listed in the settings form.
export const PANEL_KEYS = ["aiPaused"];
export const ALL_KNOWN_KEYS = [...new Set([...BASIC_KEYS, ...ADVANCED_KEYS, ...HIDDEN_KEYS, ...CLIENT_KEYS, ...PANEL_KEYS])];

export function groupFor(key) {
  if (HIDDEN_KEYS.includes(key)) return "hidden";
  if (BASIC_KEYS.includes(key)) return "basic";
  if (ADVANCED_KEYS.includes(key)) return "advanced";
  if (PANEL_KEYS.includes(key)) return "panel";
  if (CLIENT_KEYS.includes(key)) return "client";
  return "unknown";
}

// POST a ping to the webhook (never logs the secret). No URL (typical relay
// setup) falls back to whether the bot user is currently connected.
export async function testConnection({ url, secret, header = "Authorization", fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 5000, botActive = null } = {}) {
  if (!url) {
    if (botActive === true) return { ok: true, via: "botUser", message: "No webhook URL (relay mode). Bot user is connected." };
    if (botActive === false) return { ok: false, via: "botUser", error: "No webhook URL (relay mode). Bot user is not connected." };
    return { ok: false, via: "none", error: "No webhook URL configured" };
  }
  const redact = (s) => secret ? String(s).split(secret).join("[redacted]") : String(s);
  let ctrl = null, timer = null;
  try { ctrl = new AbortController(); timer = setTimeout(() => ctrl.abort(), timeoutMs); } catch { ctrl = null; }
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { [header]: secret } : {}) },
      body: JSON.stringify({ type: "testConnection", ping: true }),
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    const ok = r.status >= 200 && r.status < 300;
    return { ok, status: r.status, via: "webhook", error: ok ? null : `HTTP ${r.status}`, message: ok ? `OK (HTTP ${r.status})` : null };
  } catch (e) {
    return { ok: false, via: "webhook", error: redact(e?.message ?? e) };
  } finally { if (timer) clearTimeout(timer); }
}
