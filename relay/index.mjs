#!/usr/bin/env node
// ai-gm-relay entry. Does nothing (exits 0) unless AIGM_WEBHOOK_URL and AIGM_WEBHOOK_AUTH are set.
import { Relay, configFromEnv } from "./core.mjs";
import { connectFoundry } from "./foundry-client.mjs";
const cfg = configFromEnv();
if (!cfg) { console.log("ai-gm-relay: AIGM_WEBHOOK_URL / AIGM_WEBHOOK_AUTH not set; idle, exiting."); process.exit(0); }
for (const k of ["FOUNDRY_URL", "FOUNDRY_RELAY_USER", "FOUNDRY_RELAY_PASSWORD"]) if (!process.env[k]) { console.log(`ai-gm-relay: ${k} not set; exiting.`); process.exit(0); }
let fc;
const relay = new Relay({ ...cfg, ack: (ids) => fc?.ack(ids), runCommand: (c) => fc?.run(c) });
if (!relay.lock()) { console.log("ai-gm-relay: another relay holds the lock; exiting (one handler only)."); process.exit(1); }
fc = await connectFoundry({ url: process.env.FOUNDRY_URL, user: process.env.FOUNDRY_RELAY_USER, password: process.env.FOUNDRY_RELAY_PASSWORD,
  expectWorld: process.env.FOUNDRY_EXPECT_WORLD || undefined, onBatch: async (b) => { await relay.receive(b); relay.pump(); } });
const timer = setInterval(() => relay.pump(), 1000);
const stop = async () => { clearInterval(timer); await fc?.close(); relay.unlock(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
fc.page.on("close", () => { console.log("ai-gm-relay: page closed; exiting for restart"); stop(); });
