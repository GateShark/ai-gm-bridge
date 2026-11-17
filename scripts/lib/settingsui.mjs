// 0.8.8 settings layout: a short Basic page plus a collapsed Advanced list.
// Keys and defaults stay the same so existing worlds keep working. Internal
// state is never shown in the form.
import { isLocalNetworkUrl, lnaFetchOptions, LOCAL_NETWORK_HINT } from "./localnet.mjs";
export const HIDDEN_KEYS = ["dedupeState", "outboxState", "voiceCache", "turnClips", "contextJournals", "pushToTalkNoticeShown", "pttPosition", "linkProbe", "sessionSnapshot", "presenceSuspendUntil", "rollBonuses", "moodState"];
// Shown on the Basic page (plus the bot-user dropdown and webhook secret).
export const BASIC_KEYS = ["enabled", "botUserId", "delivery", "webhookUrl", "webhookSecret", "alwaysVoiceUsers", "ttsVoice", "voiceVolume", "voiceCaptions", "captionFont", "voiceOtherTurns", "pushToTalkKey", "combatEvents", "autoUnpause"];
export const BASIC_FIELDS = [
  ["enabled", "checkbox"],
  ["delivery", "select", ["relay", "direct"]],
  ["webhookUrl", "text"],
  ["alwaysVoiceUsers", "text"],
  ["ttsVoice", "voice"],
  ["voiceVolume", "number"],
  ["voiceCaptions", "checkbox"],
  ["captionFont", "font"],
  ["voiceOtherTurns", "checkbox"],
  ["pushToTalkKey", "text"],
  ["combatEvents", "checkbox"],
  ["autoUnpause", "checkbox"], // 0.9.0 #5
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
  ["moodPlaylists", "textarea"],
  ["moodFollowsCombat", "checkbox"],
  ["moralePrompts", "checkbox"],
  ["moraleAuto", "checkbox"],
  ["offlineNotifyAfterMs", "number"],
];
export const ADVANCED_KEYS = ADVANCED_FIELDS.map(f => f[0]);
export const CLIENT_KEYS = ["pushToTalk", "pushToTalkKey", "pushToTalkNoticeShown", "pttPosition", "ttsVoice", "voiceVolume", "voiceCaptions", "captionFont", "voiceOtherTurns"];
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
// 0.9.3 what it confirms, said plainly in the result message:
//  - with a URL: the webhook received the test event (it carries worldId/worldTitle/systemId) and answered 2xx. A 2xx is the
//    acknowledgement real batches get (the add-on has no other ack on the wire), so this is a real request/answer round trip
//    from THIS browser. It does not prove the bot will wake or reply, and real direct deliveries are sent by the bot user's browser.
//  - without a URL: only that the bot user is logged in to Foundry. The relay's own webhook is not tested from here.
export async function testConnection({ url, secret, header = "Authorization", fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 5000, botActive = null, delivery = null, worldInfo = {}, lnaSupported } = {}) {
  if (!url) {
    if (delivery === "direct") return { ok: false, via: "none", error: "Delivery is direct but the webhook URL is empty, so the bot will not receive anything. Enter the webhook URL, or switch Delivery to relay." };
    if (botActive === true) return { ok: true, via: "botUser", message: "No webhook URL (relay mode). The bot user is connected to Foundry. This does not test the relay's webhook." };
    if (botActive === false) return { ok: false, via: "botUser", error: "No webhook URL (relay mode). Bot user is not connected." };
    return { ok: false, via: "none", error: "No webhook URL configured" };
  }
  const redact = (s) => secret ? String(s).split(secret).join("[redacted]") : String(s);
  let ctrl = null, timer = null;
  const testId = `test:${Date.now().toString(36)}`;
  try { ctrl = new AbortController(); timer = setTimeout(() => ctrl.abort(), timeoutMs); } catch { ctrl = null; }
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { [header]: secret } : {}), "idempotency-key": testId },
      body: JSON.stringify({ type: "testConnection", ping: true, testId, ...(worldInfo ?? {}) }),
      ...lnaFetchOptions(url, lnaSupported), // 0.9.4: lets Chrome ask for local-network permission (a click started this test)
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    const ok = r.status >= 200 && r.status < 300;
    return { ok, status: r.status, via: "webhook", roundTrip: ok, error: ok ? null : `HTTP ${r.status}`,
      message: ok ? `OK (HTTP ${r.status}). The webhook received the test event and answered 2xx, like it must for real events. This does not prove the bot will reply.` : null };
  } catch (e) {
    const local = isLocalNetworkUrl(url);
    if (e?.name === "AbortError") return { ok: false, via: "webhook", timeout: true, ...(local ? { localNetwork: true } : {}), error: `No answer within ${Math.round(timeoutMs / 1000)} s (timeout)${local ? ". " + LOCAL_NETWORK_HINT : ""}` };
    if (e instanceof TypeError) {
      if (local) return { ok: false, via: "webhook", localNetwork: true, error: `Could not reach the webhook. ${LOCAL_NETWORK_HINT}` };
      return { ok: false, via: "webhook", error: redact(e?.message ?? e) + " (unreachable, or the webhook blocks browser requests: direct mode needs CORS)" };
    }
    return { ok: false, via: "webhook", error: redact(e?.message ?? e) };
  } finally { if (timer) clearTimeout(timer); }
}
