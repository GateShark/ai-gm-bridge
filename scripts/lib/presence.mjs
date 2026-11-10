// 0.8.14: server-confirmed link check and last-seen tracking.
// A zombie Foundry page can still think it is connected, so "online" must not
// come from local user.active / module-socket heartbeats alone. ping writes one
// tiny nonce into a single overwritten world setting, reads it back, and only
// treats the link as OK when the nonce matches (or times out after ~5s).

export const DEFAULT_OFFLINE_AFTER_MS = 60000;
export const MIN_OFFLINE_AFTER_MS = 5000;
export const MAX_OFFLINE_AFTER_MS = 600000;
export const PING_TIMEOUT_MS = 5000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 20000;
export const PING_TIMEOUT_ERROR = "Timed out waiting for Foundry (connection may have dropped). Reconnect and try again.";
export const PING_MISMATCH_ERROR = "Foundry did not confirm the link (read-back mismatch). Reconnect and try again.";
export const COMMAND_TIMEOUT_ERROR = PING_TIMEOUT_ERROR;

export function makeNonce(now = Date.now()) {
  const n = Number(now);
  const stamp = Number.isFinite(n) ? n : Date.now();
  return `${stamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveOfflineAfterMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_OFFLINE_AFTER_MS;
  return Math.min(MAX_OFFLINE_AFTER_MS, Math.max(MIN_OFFLINE_AFTER_MS, n));
}

export function commandTimeoutMs(cmd) {
  const name = cmd?.name;
  if (name === "ping") return PING_TIMEOUT_MS;
  if (name === "move") return 120000;
  if (name === "playAudio" && cmd?.args?.wait) return 180000;
  return DEFAULT_COMMAND_TIMEOUT_MS;
}

export function withTimeout(promise, ms, message = PING_TIMEOUT_ERROR) {
  const timeoutMs = Math.max(1, Number(ms) || PING_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export function formatSince(lastSeen, now = Date.now()) {
  const n = Number(lastSeen);
  if (!Number.isFinite(n) || n <= 0) return "never";
  const ago = Math.max(0, Number(now) - n);
  if (ago < 15_000) return "just now";
  if (ago < 60_000) return `${Math.round(ago / 1000)}s ago`;
  if (ago < 3_600_000) return `${Math.round(ago / 60_000)}m ago`;
  return `${Math.round(ago / 3_600_000)}h ago`;
}

export function formatOfflineLabel(lastSeen, now = Date.now(), t = (k, f) => f || k) {
  const n = Number(lastSeen);
  if (!Number.isFinite(n) || n <= 0) return t("AIGM.status.offline", "AI GM offline");
  return t("AIGM.status.offlineSince", "AI GM offline (last seen {since})").replace("{since}", formatSince(n, now));
}

export function callerConnectionError({ user, socket, ready } = {}) {
  if (ready === false) return "Not connected: Foundry is not ready.";
  if (!user) return "Not connected: no logged-in user.";
  if (user.active === false) return "Not connected: the current user is not logged in. Reconnect and try again.";
  if (socket && (socket.connected === false || socket.disconnected === true)) {
    return "Not connected: the Foundry socket is down. Reconnect and try again.";
  }
  return null;
}

// The bot's own page must not trust its local user.active (it can stay stale
// true after the server has dropped it). Other clients can trust the server-
// synced users list, and everyone can trust a recent confirmed nonce timestamp.
export function isLinkFresh({
  botActive = false, lastConfirmed = 0, now = Date.now(),
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS, selfIsBot = false
} = {}) {
  const threshold = resolveOfflineAfterMs(offlineAfterMs);
  const recent = Number(lastConfirmed) > 0 && (now - Number(lastConfirmed)) <= threshold;
  if (selfIsBot) return recent;
  if (botActive === true) return true;
  return recent;
}

export function nextProbeValue({ nonce, at, by = "", isBotWriter = false, prev = null } = {}) {
  const lastBotAt = isBotWriter ? at : (Number(prev?.lastBotAt) || 0);
  return { nonce, at, by: by || "", lastBotAt };
}

export function lastSeenFromProbe(probe, { botUserId = "" } = {}) {
  const lastBotAt = Number(probe?.lastBotAt);
  if (Number.isFinite(lastBotAt) && lastBotAt > 0) return lastBotAt;
  if (botUserId && probe?.by === botUserId) {
    const at = Number(probe?.at);
    if (Number.isFinite(at) && at > 0) return at;
  }
  return 0;
}

export function presenceSnapshot({
  now = Date.now(), worldId = null, botUser = null, probe = null, botUserId = ""
} = {}) {
  const seen = lastSeenFromProbe(probe, { botUserId: botUser?.id || botUserId });
  return {
    serverTime: now,
    gmUserActive: !!botUser?.active,
    lastSeen: seen > 0 ? seen : null,
    worldId: worldId ?? null
  };
}

// Never put a Foundry User/Actor document on an API or event payload (circular refs).
export function plainUser(user) {
  if (!user || typeof user !== "object") return null;
  const id = user.id ?? null;
  const name = user.name == null ? null : String(user.name);
  if (id == null && (name == null || name === "")) return null;
  return { id, name, active: !!user.active };
}

export function publicPresence({
  now = Date.now(), worldId = null, botUser = null, probe = null, botUserId = "", lastConfirmed = 0
} = {}) {
  const snap = presenceSnapshot({ now, worldId, botUser, probe, botUserId });
  if (!snap.lastSeen && lastConfirmed) snap.lastSeen = lastConfirmed;
  return { ...snap, bot: plainUser(botUser), botActive: !!botUser?.active };
}

export const MAX_PRESENCE_SUSPEND_S = 600;

export function resolvePresenceSuspendSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_PRESENCE_SUSPEND_S, Math.floor(n));
}

export function isPresenceSuspended(until, now = Date.now()) {
  return Number(until) > Number(now);
}

// Periodic nonce refresh: skip while a GM debug suspend is in effect.
export function shouldProbeLink({
  enabled = false, isBot = false, now = Date.now(), nextProbeAt = 0, suspendUntil = 0
} = {}) {
  if (!enabled || !isBot) return false;
  if (isPresenceSuspended(suspendUntil, now)) return false;
  if (nextProbeAt && now < nextProbeAt) return false;
  return true;
}

// While suspended, do not trust user.active — only the last confirmed nonce
// (same rule as the bot's own page). After the offline threshold the light
// can show "AI GM offline" even if the bot user is still listed as connected.
export function presenceFreshOpts({
  botActive = false, lastSeen = 0, now = Date.now(),
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS, selfIsBot = false, suspendUntil = 0
} = {}) {
  const suspended = isPresenceSuspended(suspendUntil, now);
  return {
    botActive: suspended ? false : !!botActive,
    lastConfirmed: Number(lastSeen) || 0,
    now,
    offlineAfterMs,
    selfIsBot: !!(selfIsBot || suspended)
  };
}

export function findBotUser(users, { botUserId = "", botUserName = "" } = {}) {
  const list = toUserList(users);
  if (botUserId) {
    const u = list.find(x => x.id === botUserId) || users?.get?.(botUserId);
    if (u) return u;
  }
  if (botUserName) {
    const p = String(botUserName).toLowerCase();
    const u = list.find(x => x.isGM && String(x.name || "").toLowerCase().startsWith(p));
    if (u) return u;
  }
  return null;
}

function toUserList(users) {
  if (!users) return [];
  if (Array.isArray(users)) return users;
  if (Array.isArray(users.contents)) return users.contents;
  try { return [...users]; } catch { return []; }
}

function nonceOf(read) {
  if (read && typeof read === "object" && !Array.isArray(read) && read.nonce != null) return String(read.nonce);
  if (read && typeof read === "object" && read.value != null) return nonceOf(read.value);
  return read == null ? "" : String(read);
}

export async function confirmLink({
  setProbe, getProbe, now = Date.now(), nonce, timeoutMs = PING_TIMEOUT_MS, extra = {}
} = {}) {
  const token = nonce || makeNonce(now);
  const written = { nonce: token, at: now, ...extra };
  if (typeof setProbe !== "function" || typeof getProbe !== "function") {
    return { ok: false, serverTime: now, at: null, nonce: token, error: "Not connected: Foundry is not ready.", data: null };
  }
  try {
    const read = await withTimeout((async () => {
      await setProbe(written);
      return await getProbe();
    })(), timeoutMs, PING_TIMEOUT_ERROR);
    const match = nonceOf(read) === String(token);
    const data = read && typeof read === "object" ? read : { nonce: read };
    return {
      ok: match,
      serverTime: now,
      at: Number(data?.at) || now,
      nonce: token,
      error: match ? null : PING_MISMATCH_ERROR,
      data
    };
  } catch (e) {
    return { ok: false, serverTime: now, at: null, nonce: token, error: e?.message || PING_TIMEOUT_ERROR, data: null };
  }
}

// Overwrite the same hidden setting key (no growth). lastBotAt is only advanced
// when the writer is the AI GM bot user, so a human GM's Test connection does
// not look like the bot was just seen.
export async function runLinkProbe({
  setSetting, getSetting, now = Date.now(), userId = "", isBotWriter = false, timeoutMs = PING_TIMEOUT_MS
} = {}) {
  return confirmLink({
    now, timeoutMs, nonce: makeNonce(now),
    setProbe: async (written) => {
      let prev = null;
      try { prev = getSetting(); } catch { prev = null; }
      return setSetting(nextProbeValue({
        nonce: written.nonce, at: written.at, by: userId, isBotWriter, prev
      }));
    },
    getProbe: () => getSetting()
  });
}

export function formatLinkCheckLine(probe, presence = {}, t = (k, f) => f || k) {
  const seen = formatSince(presence.lastSeen, presence.serverTime || Date.now());
  if (probe?.ok) return t("AIGM.config.linkOk", "Link check OK (last seen {since}).").replace("{since}", seen);
  return t("AIGM.config.linkFail", "Link check failed: {error}").replace("{error}", probe?.error || "connection may have dropped");
}

export function formatPanelLink(link, t = (k, f) => f || k) {
  if (!link) return "";
  const state = link.state || (link.offline ? "offline" : "");
  if (state === "offline") return formatOfflineLabel(link.lastSeen, link.now, t);
  if (state === "thinking") return t("AIGM.status.thinking", "GM thinking…");
  if (state === "paused") return t("AIGM.status.paused", "GM paused");
  if (state === "listening") return t("AIGM.status.listening", "GM listening");
  return "";
}
