// 0.9.3: "bot not receiving" check, and the world identity every payload carries.
// Pure helpers first (no Foundry globals), then thin live wrappers that read the game when they are called.
import { findBotUser } from "./presence.mjs";

const MOD = "ai-gm-bridge";
export const ACK_WINDOW_MS = 120000;   // an event that went out and was never acknowledged for this long means nobody is receiving
export const FAIL_AFTER = 3;           // this many failed deliveries in a row (direct mode) means the webhook is not taking events

// worldId / worldTitle / systemId: added to every event and batch so one bot or routine can serve many worlds.
export function worldInfo(g = globalThis.game) {
  return { worldId: g?.world?.id ?? null, worldTitle: g?.world?.title ?? g?.world?.name ?? null, systemId: g?.system?.id ?? g?.world?.system ?? null };
}

// Deliveries seen by this client (the leader, in direct mode). Consecutive failures reset on any 2xx.
export function createDeliveryHealth() {
  return {
    failures: 0, lastError: null, lastStatus: null, lastFailAt: null, lastOkAt: null,
    ok(now = Date.now()) { this.failures = 0; this.lastError = null; this.lastStatus = null; this.lastOkAt = now; },
    fail({ status = null, error = null } = {}, now = Date.now()) { this.failures++; this.lastStatus = status ?? null; this.lastError = error ? String(error).slice(0, 200) : null; this.lastFailAt = now; },
    reset() { this.failures = 0; this.lastError = null; this.lastStatus = null; this.lastFailAt = null; this.lastOkAt = null; }
  };
}
export const deliveryHealth = createDeliveryHealth();

// Decide whether the bot can be receiving. Returns { state: "off"|"ok"|"warn", ok, problems: [{ code, text }], text }.
//   noBotUser        enabled but no bot user is picked (or it is gone), so nothing can lead or deliver
//   noWebhook        direct delivery with an empty webhook URL
//   deliveryFailing  direct deliveries failed FAIL_AFTER times in a row
//   noAck            an event went out and nothing acknowledged it within ackWindowMs
export function evaluateReceiving({ enabled = false, delivery = "relay", webhookUrl = "", botFound = true, items = [], failures = 0, lastStatus = null, lastError = null, now = Date.now(), ackWindowMs = ACK_WINDOW_MS, failAfter = FAIL_AFTER } = {}) {
  if (!enabled) return { state: "off", ok: true, problems: [], text: "" };
  const problems = [];
  const direct = delivery === "direct";
  if (!botFound) problems.push({ code: "noBotUser", text: "no bot user is picked (Configure AI GM Pirate Borg > Bot GM user), so the bot shows offline" });
  if (direct && !String(webhookUrl ?? "").trim()) problems.push({ code: "noWebhook", text: "delivery is direct but the webhook URL is empty, so no event can reach the bot" });
  if (direct && String(webhookUrl ?? "").trim() && failures >= failAfter) {
    const why = lastStatus ? `HTTP ${lastStatus}` : (lastError || "no answer");
    problems.push({ code: "deliveryFailing", text: `the last ${failures} deliveries to the webhook failed (${why})` });
  }
  const sent = (items ?? []).filter(i => (i?.attempts ?? 0) > 0 && i?.firstAt != null);
  if (sent.length) {
    const oldest = Math.min(...sent.map(i => i.firstAt));
    if (now - oldest >= ackWindowMs && !problems.some(p => p.code === "noWebhook" || p.code === "deliveryFailing")) {
      problems.push({ code: "noAck", text: `${sent.length === 1 ? "an event" : `${sent.length} events`} went out ${Math.round((now - oldest) / 1000)} s ago and the bot has not acknowledged ${sent.length === 1 ? "it" : "them"}` });
    }
  }
  if (!problems.length) return { state: "ok", ok: true, problems: [], text: "" };
  return { state: "warn", ok: false, problems, text: `Bot not receiving: ${problems.map(p => p.text).join("; ")}. Check the bot's webhook or relay (see docs/SETUP.md, "Connect the bot").` };
}

// Live wrappers. main.mjs gives the outbox in memory; any other client falls back to the persisted copy.
let outboxProvider = null;
export function setOutboxProvider(fn) { outboxProvider = typeof fn === "function" ? fn : null; }
export function liveBotReceiving({ now = Date.now(), g = globalThis.game, health = deliveryHealth } = {}) {
  try {
    if (g?.user && !g.user.isGM) return { state: "off", ok: true, problems: [], text: "" }; // GM-only
    const get = (k) => g?.settings?.get?.(MOD, k);
    const enabled = !!get("enabled");
    if (!enabled) return { state: "off", ok: true, problems: [], text: "" };
    let items = null;
    try { items = outboxProvider?.() ?? null; } catch { items = null; }
    if (!items) { try { items = get("outboxState")?.items ?? []; } catch { items = []; } }
    const users = g?.users?.contents ?? g?.users ?? [];
    const bot = findBotUser(users, { botUserId: get("botUserId") || "", botUserName: get("botUserId") ? "" : (get("botUserName") || "") });
    return evaluateReceiving({ enabled, delivery: get("delivery") || "relay", webhookUrl: get("webhookUrl") || "", botFound: !!bot, items, failures: health.failures, lastStatus: health.lastStatus, lastError: health.lastError, now });
  } catch { return { state: "off", ok: true, problems: [], text: "" }; }
}

// One-time GM notification per problem set: warns when a new problem code appears, again only after it cleared.
export function createReceivingNotifier({ notify } = {}) {
  let shown = new Set();
  return {
    check(r) {
      if (!r || r.state !== "warn") { shown = new Set(); return false; }
      const fresh = r.problems.filter(p => !shown.has(p.code));
      for (const p of r.problems) shown.add(p.code);
      if (!fresh.length) return false;
      try { notify?.(r.text); } catch {}
      return true;
    },
    reset() { shown = new Set(); }
  };
}
