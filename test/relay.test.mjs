import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Relay, configFromEnv } from "../relay/core.mjs";
const SECRET = "s3cr3t-token";
function mk(statuses, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-")); const calls = [], acks = [], logs = []; let t = opts.t ?? 0;
  const fetchImpl = async (url, init) => { calls.push(init); const s = statuses.shift() ?? 200; if (s === "throw") throw new Error("net " + SECRET); return { status: s }; };
  const r = new Relay({ url: "http://x", auth: SECRET, dataDir: dir, fetchImpl, ack: async ids => acks.push(...ids), log: (...a) => logs.push(a.join(" ")), now: () => t });
  return { r, calls, acks, logs, dir, tick: ms => (t += ms) };
}
const batch = (id, ...ev) => ({ batchId: id, world: "test-world", events: ev.map(e => ({ eventId: e })) });
test("env unset → null config (do nothing)", () => { assert.equal(configFromEnv({}), null); assert.equal(configFromEnv({ AIGM_WEBHOOK_URL: "u" }), null); });
test("ack only after 2xx; auth sent but never logged", async () => {
  const k = mk([500, "throw", 200]);
  await k.r.receive(batch("b1", "chat:1"));
  await k.r.pump(); assert.deepEqual(k.acks, []);
  k.tick(2000); await k.r.pump(); assert.deepEqual(k.acks, []);
  k.tick(5000); await k.r.pump(); assert.deepEqual(k.acks, ["chat:1"]);
  assert.equal(k.calls.length, 3); assert.equal(k.calls[0].headers.Authorization, SECRET);
  assert.ok(k.calls.every(c => c.headers["idempotency-key"] === "b1"));
  assert.ok(!k.logs.join("\n").includes(SECRET)); assert.ok(!JSON.stringify(k.r).includes(SECRET));
});
test("one handler per message: re-emitted batch/event not POSTed again, just re-acked", async () => {
  const k = mk([200]);
  await k.r.receive(batch("b1", "chat:1")); await k.r.pump();
  assert.equal((await k.r.receive(batch("b1", "chat:1"))).reason, "duplicate");
  await k.r.receive(batch("b2", "chat:1", "chat:2")); await k.r.pump();
  assert.equal(k.calls.length, 2); assert.deepEqual(JSON.parse(k.calls[1].body).events.map(e => e.eventId), ["chat:2"]);
  assert.deepEqual(k.acks, ["chat:1", "chat:1", "chat:1", "chat:2"]);
});
test("inflight event in a different batch is not double-queued; concurrent pumps POST once", async () => {
  const k = mk([200]);
  await k.r.receive(batch("b1", "chat:9")); assert.equal((await k.r.receive(batch("b2", "chat:9"))).reason, "duplicate");
  await Promise.all([k.r.pump(), k.r.pump()]); assert.equal(k.calls.length, 1);
});
test("done-set survives restart", async () => {
  const k = mk([200]); await k.r.receive(batch("b1", "chat:1")); await k.r.pump();
  const r2 = new Relay({ url: "http://x", auth: SECRET, dataDir: k.dir, fetchImpl: async () => ({ status: 200 }), ack: async () => {}, log: () => {} });
  assert.equal((await r2.receive(batch("b9", "chat:1"))).reason, "duplicate");
});
test("4xx → dead, no ack", async () => {
  const k = mk([401]); await k.r.receive(batch("b1", "chat:1")); const o = await k.r.pump();
  assert.ok(o[0].dead); assert.deepEqual(k.acks, []);
});
test("lockfile: second relay on same dir refused", () => {
  const k = mk([]); assert.ok(k.r.lock());
  fs.writeFileSync(path.join(k.dir, "relay.lock"), String(process.ppid)); // simulate a live other process
  const r2 = new Relay({ url: "u", auth: "a", dataDir: k.dir, ack: async () => {}, log: () => {} });
  assert.equal(r2.lock(), false); k.r.unlock();
});
