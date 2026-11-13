// 0.8.14: server round-trip ping, last-seen / offline light, fail-fast, setup refresh, logo.
import test from "node:test"; import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  makeNonce, resolveOfflineAfterMs, commandTimeoutMs, withTimeout, formatSince,
  formatOfflineLabel, callerConnectionError, isLinkFresh, nextProbeValue,
  lastSeenFromProbe, presenceSnapshot, findBotUser, confirmLink, runLinkProbe,
  formatLinkCheckLine, formatPanelLink, PING_TIMEOUT_ERROR, PING_MISMATCH_ERROR,
  DEFAULT_OFFLINE_AFTER_MS, PING_TIMEOUT_MS
} from "../scripts/lib/presence.mjs";
import { deriveGmStatus, GmStatusPill, STATUS_ID } from "../scripts/lib/gmstatus.mjs";
import { panelHtml, PANEL_LOGO_SRC } from "../scripts/lib/gmpanel.mjs";
import { groupFor, HIDDEN_KEYS, ADVANCED_KEYS } from "../scripts/lib/settingsui.mjs";

test("0.8.14 resolveOfflineAfterMs, formatSince, commandTimeoutMs", () => {
  assert.equal(resolveOfflineAfterMs(undefined), DEFAULT_OFFLINE_AFTER_MS);
  assert.equal(resolveOfflineAfterMs("nope"), DEFAULT_OFFLINE_AFTER_MS);
  assert.equal(resolveOfflineAfterMs(1000), 5000);
  assert.equal(resolveOfflineAfterMs(9999999), 600000);
  assert.equal(resolveOfflineAfterMs(45000), 45000);
  assert.equal(formatSince(0), "never");
  assert.equal(formatSince(1000, 2000), "just now");
  assert.equal(formatSince(1000, 1000 + 20000), "20s ago");
  assert.equal(formatSince(1000, 1000 + 120000), "2m ago");
  assert.equal(formatSince(1000, 1000 + 7200000), "2h ago");
  assert.equal(formatOfflineLabel(null), "AI GM offline");
  assert.equal(formatOfflineLabel(1000, 1000 + 120000), "AI GM offline (last seen 2m ago)");
  assert.equal(commandTimeoutMs({ name: "ping" }), PING_TIMEOUT_MS);
  assert.equal(commandTimeoutMs({ name: "move" }), 120000);
  assert.equal(commandTimeoutMs({ name: "playAudio", args: { wait: true } }), 180000);
  assert.equal(commandTimeoutMs({ name: "post" }), 20000);
});

test("0.8.14 callerConnectionError fail-fast", () => {
  assert.equal(callerConnectionError({ ready: false }), "Not connected: Foundry is not ready.");
  assert.equal(callerConnectionError({}), "Not connected: no logged-in user.");
  assert.match(callerConnectionError({ user: { active: false } }), /not logged in/);
  assert.match(callerConnectionError({ user: { active: true }, socket: { connected: false } }), /socket is down/);
  assert.match(callerConnectionError({ user: { active: true }, socket: { disconnected: true } }), /socket is down/);
  assert.equal(callerConnectionError({ user: { active: true }, socket: { connected: true }, ready: true }), null);
});

test("0.8.14 isLinkFresh: bot page ignores stale user.active; others trust server list", () => {
  assert.equal(isLinkFresh({ selfIsBot: true, botActive: true, lastConfirmed: 0, now: 10_000, offlineAfterMs: 60000 }), false);
  assert.equal(isLinkFresh({ selfIsBot: true, botActive: true, lastConfirmed: 9_000, now: 10_000, offlineAfterMs: 60000 }), true);
  assert.equal(isLinkFresh({ selfIsBot: true, botActive: true, lastConfirmed: 1_000, now: 80_000, offlineAfterMs: 60000 }), false);
  assert.equal(isLinkFresh({ selfIsBot: false, botActive: true, lastConfirmed: 0, now: 10_000, offlineAfterMs: 60000 }), true);
  assert.equal(isLinkFresh({ selfIsBot: false, botActive: false, lastConfirmed: 1_000, now: 80_000, offlineAfterMs: 60000 }), false);
  assert.equal(isLinkFresh({ selfIsBot: false, botActive: false, lastConfirmed: 70_000, now: 80_000, offlineAfterMs: 60000 }), false);
});

test("0.8.14 deriveGmStatus uses lastConfirmed, not local lastBeat", () => {
  assert.equal(deriveGmStatus({ enabled: true, leaderIsBot: true, lastBeat: 1000, now: 2000, timeoutMs: 45000 }), "offline");
  assert.equal(deriveGmStatus({ enabled: true, selfIsBot: true, botActive: true, lastConfirmed: 0, now: 10_000, offlineAfterMs: 60000 }), "offline");
  assert.equal(deriveGmStatus({ enabled: true, selfIsBot: true, lastConfirmed: 9_000, now: 10_000, offlineAfterMs: 60000 }), "listening");
  assert.equal(deriveGmStatus({ enabled: true, botActive: true }), "listening");
  assert.equal(deriveGmStatus({ enabled: true, thinking: true, lastConfirmed: 9_000, now: 10_000 }), "thinking");
});

test("0.8.14 confirmLink success, mismatch, and hang/timeout", async () => {
  let stored = null;
  const ok = await confirmLink({
    now: 1000, nonce: "abc",
    setProbe: async (v) => { stored = v; },
    getProbe: async () => stored
  });
  assert.equal(ok.ok, true);
  assert.equal(stored.nonce, "abc");
  assert.equal(stored.at, 1000);
  assert.equal(ok.error, null);

  const mismatch = await confirmLink({
    nonce: "abc",
    setProbe: async () => {},
    getProbe: async () => ({ nonce: "other", at: 1 })
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, PING_MISMATCH_ERROR);

  const hung = await confirmLink({
    timeoutMs: 25, nonce: "abc",
    setProbe: () => new Promise(() => {}),
    getProbe: async () => ({ nonce: "abc" })
  });
  assert.equal(hung.ok, false);
  assert.equal(hung.error, PING_TIMEOUT_ERROR);
});

test("0.8.14 runLinkProbe overwrites one key and only advances lastBotAt for the bot", async () => {
  let stored = { nonce: "old", at: 10, by: "bot1", lastBotAt: 10 };
  const human = await runLinkProbe({
    now: 50, userId: "gm1", isBotWriter: false, nonce: "nope",
    setSetting: (v) => { stored = v; },
    getSetting: () => stored
  });
  assert.equal(human.ok, true);
  assert.equal(stored.lastBotAt, 10);
  assert.equal(stored.by, "gm1");
  assert.ok(stored.nonce && stored.nonce !== "old");

  const bot = await runLinkProbe({
    now: 80, userId: "bot1", isBotWriter: true,
    setSetting: (v) => { stored = v; },
    getSetting: () => stored
  });
  assert.equal(bot.ok, true);
  assert.equal(stored.lastBotAt, 80);
  assert.equal(stored.by, "bot1");
  assert.equal(lastSeenFromProbe(stored, { botUserId: "bot1" }), 80);
  assert.deepEqual(presenceSnapshot({ now: 90, worldId: "pb-test", botUser: { id: "bot1", active: true }, probe: stored, botUserId: "bot1" }), {
    serverTime: 90, gmUserActive: true, lastSeen: 80, worldId: "pb-test"
  });
});

test("0.8.14 withTimeout rejects a hanging promise", async () => {
  const t0 = Date.now();
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20, "boom"), /boom/);
  assert.ok(Date.now() - t0 < 500);
});

test("0.8.14 nextProbeValue, findBotUser, format lines", () => {
  assert.deepEqual(nextProbeValue({ nonce: "n", at: 5, by: "u", isBotWriter: true, prev: { lastBotAt: 1 } }), {
    nonce: "n", at: 5, by: "u", lastBotAt: 5
  });
  assert.equal(nextProbeValue({ nonce: "n", at: 5, by: "u", isBotWriter: false, prev: { lastBotAt: 3 } }).lastBotAt, 3);
  const users = [{ id: "g", name: "GM", isGM: true }, { id: "b", name: "AI GM", isGM: true, active: true }];
  assert.equal(findBotUser(users, { botUserId: "b" }).name, "AI GM");
  assert.equal(findBotUser(users, { botUserName: "ai" }).id, "b");
  assert.match(makeNonce(1000), /^rs-[0-9a-z]+$/);
  assert.match(formatLinkCheckLine({ ok: true }, { lastSeen: 1000, serverTime: 2000 }), /Link check OK/);
  assert.match(formatLinkCheckLine({ ok: false, error: "nope" }, {}), /Link check failed: nope/);
  assert.equal(formatPanelLink({ state: "offline", lastSeen: 1000, now: 1000 + 120000 }), "AI GM offline (last seen 2m ago)");
  assert.equal(formatPanelLink({ state: "listening" }), "GM listening");
});

test("0.8.14 ping and turnStatus commands expose presence fields", async () => {
  const cmds = readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8");
  assert.match(cmds, /ping: \{ schema: \{\}/);
  assert.match(cmds, /runPing/);
  assert.match(cmds, /livePresenceFields/);
  assert.match(cmds, /turnStatus: \{ schema: \{\}/);
  assert.match(cmds, /\.\.\.livePresenceFields\(\)/);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /ping: async \(\) =>/);
  assert.match(main, /name !== "ping"/);
  // Exercise the same path the command uses, with a mocked world setting store.
  const store = { linkProbe: { nonce: "", at: 0, by: "", lastBotAt: 0 } };
  const users = [{ id: "bot1", name: "AI GM", isGM: true, active: true }];
  const ping = await (async () => {
    const now = 5000;
    const bot = findBotUser(users, { botUserId: "bot1" });
    const conn = callerConnectionError({ user: { id: "bot1", active: true }, socket: { connected: true }, ready: true });
    assert.equal(conn, null);
    const outcome = await runLinkProbe({
      now, userId: "bot1", isBotWriter: true,
      setSetting: (v) => { store.linkProbe = v; },
      getSetting: () => store.linkProbe
    });
    const result = presenceSnapshot({ now, worldId: "pb-test", botUser: bot, probe: store.linkProbe, botUserId: "bot1" });
    return { outcome, result };
  })();
  assert.equal(ping.outcome.ok, true);
  assert.equal(ping.result.worldId, "pb-test");
  assert.equal(ping.result.gmUserActive, true);
  assert.equal(ping.result.lastSeen, store.linkProbe.lastBotAt);
  assert.ok(store.linkProbe.nonce);
  const ts = presenceSnapshot({ now: 6000, worldId: "pb-test", botUser: findBotUser(users, { botUserId: "bot1" }), probe: store.linkProbe, botUserId: "bot1" });
  assert.equal(ts.gmUserActive, true);
  assert.equal(ts.worldId, "pb-test");
  assert.equal(ts.lastSeen, store.linkProbe.lastBotAt);
});

test("0.8.14 status pill shows AI GM offline with time since last seen", () => {
  const els = new Map();
  const doc = { els, body: { appendChild: (e) => els.set(e.id, e) }, getElementById: (id) => els.get(id) ?? null,
    createElement: () => { const e = { style: {}, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, remove() { els.delete(this.id); } }; return e; } };
  const p = new GmStatusPill({ doc, t: (k, f) => f });
  p.mount();
  p.set("offline", { lastSeen: 1000, now: 1000 + 120000 });
  assert.equal(doc.els.get(STATUS_ID).dataset.state, "offline");
  assert.equal(doc.els.get(STATUS_ID).textContent, "AI GM offline (last seen 2m ago)");
});

test("0.8.14 panel header logo and offline line; settings and wiring", () => {
  const html = panelHtml({ link: { state: "offline", lastSeen: 1000, now: 1000 + 120000 } });
  assert.match(html, /aigm-panel-logo/);
  assert.match(html, /aigm-panel-brand/);
  assert.match(html, /AI GM offline \(last seen 2m ago\)/);
  assert.match(html, new RegExp(PANEL_LOGO_SRC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(groupFor("offlineAfterMs"), "advanced");
  assert.equal(groupFor("linkProbe"), "hidden");
  assert.ok(HIDDEN_KEYS.includes("linkProbe"));
  assert.ok(ADVANCED_KEYS.includes("offlineAfterMs"));
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /deleteToken/);
  assert.match(main, /createToken/);
  assert.match(main, /updateToken/);
  assert.match(main, /deleteActor/);
  assert.match(main, /offlineAfterMs", Number, 60000/);
  assert.match(main, /linkProbe/);
  assert.match(main, /callerConnectionError/);
  assert.match(main, /withTimeout/);
  assert.match(main, /maybeProbeLink/);
  const cfg = readFileSync(new URL("../scripts/config-app.mjs", import.meta.url), "utf8");
  assert.match(cfg, /runLinkProbe/);
  assert.match(cfg, /formatLinkCheckLine/);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).AIGM;
  assert.equal(en.status.offline, "AI GM offline");
  assert.match(en.status.offlineSince, /last seen/);
  assert.equal(en.settings.offlineAfterMs.name, "AI GM offline after (ms)");
});

test("0.8.14 version, logo files, and module.json media", () => {
  const mj = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.match(mj.version, /^0\.8\.(1[4-9]|2\d)$/);
  assert.match(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, /^0\.8\.(1[4-9]|2\d)$/);
  assert.ok(Array.isArray(mj.media));
  const types = mj.media.map(m => m.type);
  assert.ok(types.includes("icon"));
  assert.ok(types.includes("cover"));
  const root = new URL("../", import.meta.url);
  assert.ok(existsSync(new URL("assets/logo.png", root)));
  assert.ok(existsSync(new URL("assets/logo-256.webp", root)) || existsSync(new URL("assets/logo-256.png", root)));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /assets\/logo/);
  assert.match(readme, /width="160"/);
  assert.match(readme, /align="center"/);
  assert.match(readme, /v0\.8\.1[456789]/);
  assert.match(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), /## 0\.8\.14/);
  assert.match(readFileSync(new URL("../docs/BOT-API.md", import.meta.url), "utf8"), /ping/);
});
