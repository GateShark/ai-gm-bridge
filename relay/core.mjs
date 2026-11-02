// ai-gm-relay core: durable, single-handler delivery of module event batches to any bot's webhook.
// The webhook may answer 2xx with {"commands":[{name,args,commandId}]}; they run in Foundry before the ack.
// Guarantees: (1) one relay process per data dir (O_EXCL lockfile); (2) each eventId is delivered at most once
// after a 2xx (persisted done-set), re-emitted batches are acked without re-POST; (3) the module is acked only
// after a 2xx; (4) retries keep the same Idempotency-Key; (5) the auth header is never logged.
import fs from "node:fs"; import path from "node:path";

export const BACKOFF_MS = [2000, 5000, 15000, 60000, 60000, 60000];
export function configFromEnv(env = process.env) {
  // AIGM_* names.
  const e = (k) => env[`AIGM_${k}`];
  const url = e("WEBHOOK_URL"), auth = e("WEBHOOK_AUTH");
  if (!url || !auth) return null; // do nothing unless both are set
  return { url, auth, authHeader: e("WEBHOOK_AUTH_HEADER") || "Authorization", dataDir: e("RELAY_DATA") || "./relay-data",
    contextJournals: e("CONTEXT_JOURNALS") || "" }; // GM-only journal list; lives only in the relay env, never in Foundry
}
// getContext without `journals` gets the relay's AIGM_CONTEXT_JOURNALS list.
export function withContextDefaults(c, list) {
  if (c?.name !== "getContext" || !list || (c.args && c.args.journals != null && c.args.journals !== "")) return c;
  return { ...c, args: { ...(c.args ?? {}), journals: list } };
}
export const redact = (s, secret) => secret ? String(s).split(secret).join("[redacted]") : String(s);

export class Relay {
  constructor({ url, auth, authHeader = "Authorization", dataDir, fetchImpl = (...a) => globalThis.fetch(...a), ack, runCommand = null, contextJournals = "", log = (...a) => console.log(...a), now = Date.now, maxAttempts = BACKOFF_MS.length + 1 }) {
    Object.assign(this, { url, authHeader, dataDir, fetchImpl, ack, runCommand, now, maxAttempts, contextJournals });
    Object.defineProperty(this, "auth", { value: auth, enumerable: false }); // keep out of JSON/inspect
    this.log = (...a) => log(...a.map(x => redact(typeof x === "string" ? x : JSON.stringify(x), auth)));
    fs.mkdirSync(path.join(dataDir, "queue"), { recursive: true });
    this.donePath = path.join(dataDir, "done.json");
    this.done = new Map(fs.existsSync(this.donePath) ? JSON.parse(fs.readFileSync(this.donePath, "utf8")) : []);
    this.inflight = new Set(); this.sending = false;
  }
  lock() {
    const p = path.join(this.dataDir, "relay.lock");
    try { const fd = fs.openSync(p, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); this.lockPath = p; return true; }
    catch {
      const pid = Number(fs.readFileSync(p, "utf8")); let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
      if (alive && pid !== process.pid) return false;
      fs.rmSync(p, { force: true }); return this.lock();
    }
  }
  unlock() { if (this.lockPath) fs.rmSync(this.lockPath, { force: true }); }
  _saveDone() { const e = [...this.done.entries()].slice(-5000); this.done = new Map(e); fs.writeFileSync(this.donePath + ".tmp", JSON.stringify(e)); fs.renameSync(this.donePath + ".tmp", this.donePath); }
  _qfile(batchId) { return path.join(this.dataDir, "queue", encodeURIComponent(batchId) + ".json"); }

  // Called for every batch the module emits (including module-side retries of the same batch).
  async receive(batch) {
    if (!batch?.batchId || !Array.isArray(batch.events)) return { accepted: false, reason: "bad batch" };
    const fresh = batch.events.filter(e => e?.eventId && !this.done.has(e.eventId) && !this.inflight.has(e.eventId));
    const already = batch.events.filter(e => this.done.has(e.eventId)).map(e => e.eventId);
    if (already.length) await this.ack(already); // module re-sent something we already delivered: just re-ack
    if (!fresh.length) return { accepted: false, reason: "duplicate", reacked: already.length };
    const item = { batch: { ...batch, events: fresh }, attempts: 0, nextAt: this.now() };
    try { fs.writeFileSync(this._qfile(batch.batchId), JSON.stringify(item), { flag: "wx" }); }
    catch { return { accepted: false, reason: "batch already queued" }; }
    fresh.forEach(e => this.inflight.add(e.eventId));
    return { accepted: true, events: fresh.length };
  }
  // Commands returned in the webhook response. Each gets a commandId (batchId:index) so a re-run is a 409, never a double action.
  async runReplyCommands(body, batchId) {
    if (!body || !this.runCommand) return [];
    let cmds; try { cmds = JSON.parse(body)?.commands; } catch { return []; }
    if (!Array.isArray(cmds)) return [];
    const out = [];
    for (const [i, c] of cmds.slice(0, 20).entries()) {
      try { out.push(await this.runCommand({ ...withContextDefaults(c, this.contextJournals), commandId: c.commandId ?? `${batchId}:${i}` })); }
      catch (e) { out.push({ ok: false, code: 500, error: String(e?.message ?? e) }); }
    }
    return out;
  }
  pending() {
    const dir = path.join(this.dataDir, "queue");
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => ({ f: path.join(dir, f), item: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
  }
  // One delivery pass; serial so a batch is never POSTed by two loops at once.
  async pump() {
    if (this.sending) return { skipped: true }; this.sending = true; const out = [];
    try {
      for (const { f, item } of this.pending()) {
        if (item.nextAt > this.now()) continue;
        const ids = item.batch.events.map(e => e.eventId); let status = 0, err = null, body = null;
        try {
          const r = await this.fetchImpl(this.url, { method: "POST", headers: { "content-type": "application/json", [this.authHeader]: this.auth, "idempotency-key": item.batch.batchId }, body: JSON.stringify(item.batch) });
          status = r.status; if (status >= 200 && status < 300) body = await r.text?.().catch(() => null);
        } catch (e) { err = e?.message ?? String(e); }
        if (status >= 200 && status < 300) {
          const t = this.now(); ids.forEach(id => { this.done.set(id, t); this.inflight.delete(id); }); this._saveDone();
          fs.rmSync(f, { force: true });
          const results = await this.runReplyCommands(body, item.batch.batchId);
          await this.ack(ids); out.push({ batchId: item.batch.batchId, ok: true, status, results });
        } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          fs.renameSync(f, f.replace(/\.json$/, ".dead")); ids.forEach(id => this.inflight.delete(id));
          this.log("relay: dead batch", item.batch.batchId, status); out.push({ batchId: item.batch.batchId, ok: false, status, dead: true });
        } else {
          item.attempts++;
          if (item.attempts >= this.maxAttempts) { fs.writeFileSync(f.replace(/\.json$/, ".dead"), JSON.stringify(item)); fs.rmSync(f); ids.forEach(id => this.inflight.delete(id)); }
          else { item.nextAt = this.now() + BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)]; fs.writeFileSync(f, JSON.stringify(item)); }
          this.log("relay: retry", item.batch.batchId, status || err); out.push({ batchId: item.batch.batchId, ok: false, status, attempts: item.attempts });
        }
      }
    } finally { this.sending = false; }
    return out;
  }
}
