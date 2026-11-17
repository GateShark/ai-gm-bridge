// 0.9.4: local-network webhooks (Chrome Local Network Access), the Test connection timeout text, docs and release metadata. Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addressSpace, isLocalNetworkUrl, lnaFetchOptions, supportsTargetAddressSpace, LOCAL_NETWORK_HINT } from "../scripts/lib/localnet.mjs";
import { testConnection } from "../scripts/lib/settingsui.mjs";
import { deliverDirect } from "../scripts/lib/direct.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("0.9.4 #1 addressSpace: loopback, private LAN and local names are detected; public hosts are not", () => {
  for (const u of ["http://127.0.0.1:8080/hook", "http://localhost:3000/x", "http://foo.localhost/x", "http://[::1]:9/x", "http://127.5.5.5/x", "http://[::ffff:127.0.0.1]/x"]) assert.equal(addressSpace(u), "loopback", u);
  for (const u of ["http://192.168.1.20/hook", "http://10.0.0.5:5678/x", "http://172.16.0.1/x", "http://172.31.255.1/x", "http://169.254.10.10/x", "http://printer.local/x", "http://[fd00::5]/x", "http://[fe80::1]/x", "http://[::ffff:192.168.0.9]/x"]) assert.equal(addressSpace(u), "local", u);
  for (const u of ["https://bot.example.com/hook", "http://172.32.0.1/x", "http://172.15.0.1/x", "http://8.8.8.8/x", "http://192.169.0.1/x", "https://httpbin.org/post", "http://[2606:4700::1]/x"]) assert.equal(addressSpace(u), "public", u);
  assert.equal(addressSpace(""), null); assert.equal(addressSpace("not a url"), null);
  assert.equal(isLocalNetworkUrl("http://192.168.1.2/x"), true); assert.equal(isLocalNetworkUrl("https://bot.example.com"), false);
});

test("0.9.4 #1 targetAddressSpace is only added for local URLs and only when the browser has it (feature check)", () => {
  assert.deepEqual(lnaFetchOptions("http://127.0.0.1:1/x", true), { targetAddressSpace: "loopback" });
  assert.deepEqual(lnaFetchOptions("http://192.168.1.2/x", true), { targetAddressSpace: "local" });
  assert.deepEqual(lnaFetchOptions("https://bot.example.com/x", true), {});
  assert.deepEqual(lnaFetchOptions("http://127.0.0.1:1/x", false), {});
  assert.equal(supportsTargetAddressSpace({}), false); assert.equal(supportsTargetAddressSpace({ Request: function () {} }), false);
  assert.equal(supportsTargetAddressSpace({ Request: class { get targetAddressSpace() { return ""; } } }), true);
  assert.equal(typeof supportsTargetAddressSpace(), "boolean");
});

test("0.9.4 #1 Test connection to a local URL that cannot be reached says the browser may block it, with the three fixes", async () => {
  let seen = null;
  const r = await testConnection({ url: "http://127.0.0.1:8099/hook", lnaSupported: true, fetchImpl: async (u, o) => { seen = o; throw new TypeError("Failed to fetch"); } });
  assert.equal(r.ok, false); assert.equal(r.localNetwork, true);
  assert.match(r.error, /browsers can block a web page from reaching a local-network address/i);
  assert.match(r.error, /public https webhook URL/); assert.match(r.error, /local-network access/); assert.match(r.error, /relay/);
  assert.doesNotMatch(r.error, /CORS/);
  assert.equal(seen.targetAddressSpace, "loopback");
  const lan = await testConnection({ url: "http://192.168.1.9/hook", lnaSupported: false, fetchImpl: async (u, o) => { seen = o; throw new TypeError("Failed to fetch"); } });
  assert.equal(lan.localNetwork, true); assert.ok(!("targetAddressSpace" in seen), "no option in a browser without it");
  // an unanswered local URL (an unanswered permission prompt looks like this) gets the timeout text and the same explanation
  const slow = await testConnection({ url: "http://localhost:1/x", timeoutMs: 20, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.match(slow.error, /^No answer within 0 s \(timeout\)\. /); assert.equal(slow.localNetwork, true);
});

test("0.9.4 #1 other failures keep the generic CORS message, a 2xx from a local URL is a real success, and nothing is faked", async () => {
  const pub = await testConnection({ url: "https://bot.example.com/hook", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.match(pub.error, /CORS/); assert.ok(!pub.localNetwork); assert.doesNotMatch(pub.error, /local-network address/);
  const http = await testConnection({ url: "http://127.0.0.1:8099/hook", fetchImpl: async () => ({ status: 500 }) });
  assert.equal(http.ok, false); assert.equal(http.error, "HTTP 500"); assert.ok(!http.localNetwork);
  const ok = await testConnection({ url: "http://127.0.0.1:8099/hook", fetchImpl: async () => ({ status: 204 }) });
  assert.equal(ok.ok, true); assert.equal(ok.roundTrip, true);
  assert.match(LOCAL_NETWORK_HINT, /Browsers can block/);
});

test("0.9.4 #1 real direct delivery to a local URL declares the address space and explains a blocked fetch in the failure text", async () => {
  let seen = null;
  const r = await deliverDirect({ batchId: "b1", events: [] }, { url: "http://192.168.1.9:8080/h", secret: "sec", fetchImpl: async (u, o) => { seen = o; throw new TypeError("Failed to fetch sec"); }, runCommand: async () => ({}), ack: async () => {} });
  assert.equal(r.ok, false); assert.match(r.error, /local-network webhook: the browser may be blocking it/); assert.ok(!r.error.includes("sec)") && !/Failed to fetch sec/.test(r.error));
  const pub = await deliverDirect({ batchId: "b2", events: [] }, { url: "https://bot.example.com/h", fetchImpl: async () => { throw new TypeError("Failed to fetch"); }, runCommand: async () => ({}), ack: async () => {} });
  assert.equal(pub.error, "Failed to fetch");
  const good = await deliverDirect({ batchId: "b3", events: [{ eventId: "e1" }] }, { url: "http://127.0.0.1:1/h", fetchImpl: async () => ({ status: 200, text: async () => "{}" }), runCommand: async () => ({}), ack: async () => {} });
  assert.equal(good.ok, true);
});

test("0.9.4 #4 an unanswered webhook reads 'No answer within N s (timeout)'", async () => {
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" }))));
  const r = await testConnection({ url: "https://bot.example.com/hook", timeoutMs: 30, fetchImpl: hang });
  assert.equal(r.ok, false); assert.equal(r.timeout, true); assert.equal(r.error, "No answer within 0 s (timeout)");
  const five = await testConnection({ url: "https://bot.example.com/hook", timeoutMs: 5000, fetchImpl: (u, o) => { setTimeout(() => {}, 0); return Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })); } });
  assert.equal(five.error, "No answer within 5 s (timeout)"); assert.doesNotMatch(five.error, /signal is aborted/);
  assert.match(src("docs/SETUP.md"), /No answer within N s \(timeout\)/); assert.match(src("docs/BOT-API.md"), /No answer within N s \(timeout\)/);
});

test("0.9.4 docs: local-network note, batch wording, setBackground row, no named 1.0 systems, known system issue, version", () => {
  const setup = src("docs/SETUP.md"), api = src("docs/BOT-API.md"), prompt = src("docs/bot-setup-prompt.md");
  for (const d of [setup, api, prompt]) assert.match(d, /Local Network Access/);
  assert.match(setup, /public https webhook URL/); assert.match(setup, /relay/);
  assert.match(setup, /goes out at once as its own batch/); assert.match(api, /flushes at once as its own batch/); assert.match(prompt, /one batch per mention line/);
  assert.match(api, /scene's initial level/); assert.doesNotMatch(api, /scene\.levels\.contents\[0\]/);
  assert.match(setup, /more game systems|more game systems are planned/i); assert.match(setup, /planned for the 1\.0 release/);
  assert.doesNotMatch(setup, /Castles|Crusades|M[ÖO]RK|C&C/);
  for (const d of [setup, api]) assert.match(d, /class-item errors/);
  assert.match(prompt, /ai-gm-bridge v0\.9\.5/);
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.5"); assert.equal(p.version, "0.9.5");
  assert.match(m.manifest, /\/releases\/latest\/download\/module\.json$/); assert.match(m.download, /\/releases\/latest\/download\/module\.zip$/);
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.5/); assert.match(src("README.md"), /v0\.9\.5/);
  assert.doesNotMatch(setup + api + prompt, /Kevin|Allen|\bKev\b|@gmail\.com/);
});

// ---------- 0.9.4 #9: turn prompts queue behind narration (and the other way round) ----------
import { AudioQueue } from "../scripts/lib/audioqueue.mjs";
const tick = () => new Promise(r => setImmediate(r));
function fakePlayer() {
  const log = []; let active = 0, maxActive = 0; const gates = new Map();
  const play = async (clip) => { active++; maxActive = Math.max(maxActive, active); log.push("start " + clip.src);
    await new Promise(res => gates.set(clip.src, res)); active--; log.push("end " + clip.src); };
  return { log, play, finish: async (src) => { gates.get(src)?.(); await tick(); await tick(); }, get maxActive() { return maxActive; }, gates };
}

test("0.9.4 #9 'Your turn' / '<name> is up' wait for a line that is playing or queued, and a new line waits for the turn clip", async () => {
  const fp = fakePlayer(); const q = new AudioQueue({ play: fp.play, gapMs: 0 });
  const g = { user: { id: "p1" }, users: { contents: [] }, settings: { get: () => true }, socket: { emit() {} } };
  globalThis.game = g; globalThis.ui = { notifications: { info() {} } };
  globalThis.foundry = { audio: { AudioHelper: { play: async () => { fp.log.push("DIRECT"); return { stop() {} }; } } }, utils: { randomID: () => "x" } };
  const F = await import("../scripts/features.mjs");
  F.initFeatures({ get: () => undefined, amLeader: () => true, queueClip: (id, clip) => q.enqueue(id, clip), isBot: () => false, log: () => {} });
  const narration = q.enqueue("voice:m1", { src: "narration1.mp3" }); const second = q.enqueue("voice:m2", { src: "narration2.mp3" });
  await tick();
  F.onTurnPing({ type: "turnPing", id: "turn:c1:1.2", userIds: ["p1"], voiceUserIds: ["p1"], text: "Your turn: Tempus", spoken: "Your turn: Tempus.", clip: "turn.mp3", audio: {} });
  assert.deepEqual(fp.log, ["start narration1.mp3"], "the turn clip does not start while narration plays");
  F.onUpPing({ type: "upPing", id: "up:c1:1.3", name: "Rat", side: "enemy", text: "Rat is up", audio: { ryan: "up.mp3" } });
  await fp.finish("narration1.mp3");
  assert.deepEqual(fp.log, ["start narration1.mp3", "end narration1.mp3", "start narration2.mp3"], "queued narration keeps its place ahead of the turn clip");
  await fp.finish("narration2.mp3"); await second;
  assert.equal(fp.log.at(-1), "start turn.mp3", "the turn clip starts the moment the line before it ends (no gap)");
  // a narration line that arrives while the turn clip plays waits for it
  const late = q.enqueue("voice:m3", { src: "narration3.mp3" }); await tick();
  assert.ok(!fp.log.includes("start narration3.mp3"));
  await fp.finish("turn.mp3"); assert.equal(fp.log.at(-1), "start up.mp3"); await fp.finish("up.mp3");
  assert.equal(fp.log.at(-1), "start narration3.mp3"); await fp.finish("narration3.mp3"); await late; await narration;
  assert.equal(fp.maxActive, 1, "never two clips at once"); assert.ok(!fp.log.includes("DIRECT"), "nothing bypasses the queue");
});

test("0.9.4 #9 'GM, wait' stops the playing clip and drops everything queued, turn clips included; nothing replays", async () => {
  const fp = fakePlayer(); let stopped = 0; const q = new AudioQueue({ play: fp.play, gapMs: 0, stop: () => { stopped++; fp.gates.get("n1.mp3")?.(); return true; } });
  const n1 = q.enqueue("voice:1", { src: "n1.mp3" }); const t1 = q.enqueue("turn:c:1.1", { src: "t1.mp3", prompt: true }); const u1 = q.enqueue("up:c:1.2", { src: "u1.mp3", prompt: true }); await tick();
  const r = q.hold(); await tick(); await tick();
  assert.equal(r.stopped, true); assert.equal(r.dropped, 2); assert.equal(stopped, 1);
  assert.equal((await t1).held, true); assert.equal((await u1).held, true); await n1;
  assert.equal(q.length, 0); assert.ok(!fp.log.includes("start t1.mp3") && !fp.log.includes("start u1.mp3"));
  assert.equal((await q.enqueue("turn:c:1.1", { src: "t1.mp3", prompt: true })).duplicate, true, "a late copy of a dropped turn clip does not play");
});

test("0.9.4 #9 no pause before or after a turn prompt; normal lines keep their short pause", async () => {
  const slept = []; const done = [];
  const q = new AudioQueue({ play: async (c) => { done.push(c.src); }, gapMs: 250, sleep: async (ms) => { slept.push(ms); } });
  await Promise.all([q.enqueue("a", { src: "a" }), q.enqueue("b", { src: "b" }), q.enqueue("t", { src: "t", prompt: true }), q.enqueue("c", { src: "c" })]);
  assert.deepEqual(done, ["a", "b", "t", "c"]); assert.deepEqual(slept, [250], "only the a→b pause remains; b→t and t→c have none");
});

test("0.9.4 #9 the turn ping is queued with its own id, and every voiced path shares the one client queue", () => {
  const f = readFileSync(new URL("../scripts/features.mjs", import.meta.url), "utf8");
  assert.match(f, /type: "turnPing", id: `turn:/); assert.match(f, /D\.queueClip\(p\.id \?\? `turn:/);
  assert.match(f, /prompt: true/);
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(main, /queueClip: \(id, clip\) => audioQueue\.enqueue\(id, clip\)/); assert.match(main, /audioQueue\.hold\(\)/);
  assert.match(readFileSync(new URL("../scripts/commands.mjs", import.meta.url), "utf8"), /return audioQueue\.enqueue\(id, \{ src, volume: clip\.volume/);
});
