import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { deliverDirect } from "../scripts/lib/direct.mjs";
import { handle } from "../examples/echo-gm.mjs";
import { Relay, configFromEnv } from "../relay/core.mjs";

const payload = { batchId: "w:abc", world: "w", ctx: { scene: "Port" }, events: [{ eventId: "chat:1", type: "chat", text: "hello" }] };
test("echo example bot replies once per batch with post+replyTo", () => {
  const r = handle(payload); assert.deepEqual(r.commands, [{ name: "post", args: { content: "Echo (in Port): hello", replyTo: "chat:1" } }]);
  assert.deepEqual(handle(payload).commands, []);
});
test("direct delivery: 2xx runs returned commands with stable commandIds, then acks; non-2xx does not ack", async () => {
  const calls = []; let acked = null;
  const fetchImpl = async (u, o) => { calls.push(o); return { status: 200, text: async () => JSON.stringify({ commands: [{ name: "post", args: { content: "x" } }] }) }; };
  const r = await deliverDirect(payload, { url: "https://hook", secret: "s3cret", fetchImpl, runCommand: async c => ({ ok: true, c }), ack: async ids => { acked = ids; } });
  assert.equal(r.ok, true); assert.equal(r.results[0].c.commandId, "w:abc:0"); assert.deepEqual(acked, ["chat:1"]);
  assert.equal(calls[0].headers.Authorization, "s3cret"); assert.equal(calls[0].headers["idempotency-key"], "w:abc");
  acked = null; const bad = await deliverDirect(payload, { url: "u", fetchImpl: async () => ({ status: 500 }), runCommand: async () => ({}), ack: async ids => { acked = ids; } });
  assert.equal(bad.ok, false); assert.equal(acked, null);
  const err = await deliverDirect(payload, { url: "u", secret: "s3cret", fetchImpl: async () => { throw new Error("boom s3cret"); }, runCommand: async () => ({}), ack: async () => {} });
  assert.ok(!err.error.includes("s3cret"));
});
test("relay: AIGM_* env names and webhook-returned commands run before ack", async () => {
  assert.equal(configFromEnv({ AIGM_WEBHOOK_URL: "u", AIGM_WEBHOOK_AUTH: "a" }).url, "u");
  assert.equal(configFromEnv({ AIGM_WEBHOOK_URL: "u", AIGM_WEBHOOK_AUTH: "a" }).auth, "a");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aigm-")); const order = [];
  const relay = new Relay({ url: "u", auth: "a", dataDir: dir, log: () => {},
    fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify(handle({ ...payload, batchId: "w:r1" })) }),
    runCommand: async (c) => { order.push("run:" + c.commandId); return { ok: true }; }, ack: async (ids) => order.push("ack:" + ids.join()) });
  await relay.receive({ ...payload, batchId: "w:r1" }); await relay.pump();
  assert.deepEqual(order, ["run:w:r1:0", "ack:chat:1"]);
});
// Private terms are assembled from fragments so this test file itself stays clean under the repo-wide privacy grep.
const PRIVATE = new RegExp([["192\\.", "168\\."], ["BEGIN ", "PRIVATE KEY"], ["gh", "p_"]].map(p => p.join("")).join("|"), "i");
test("package has no personal info or secrets", () => {
  const files = ["module.json", "README.md", "lang/en.json", "docs/BOT-API.md", "relay/RUN.md", "relay/Dockerfile", "relay/index.mjs", "relay/core.mjs", "relay/foundry-client.mjs", "examples/echo-gm.mjs", ...fs.readdirSync("scripts", { recursive: true }).filter(f => f.endsWith(".mjs")).map(f => "scripts/" + f)];
  for (const f of files) { const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, PRIVATE, f); }
});
