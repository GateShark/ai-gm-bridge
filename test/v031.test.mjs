import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs"; import { join } from "node:path";
import { Batcher } from "../scripts/lib/batcher.mjs"; import { waitForPosition } from "../scripts/lib/movewait.mjs";
import { Outbox } from "../scripts/lib/outbox.mjs";

// Mimic browser natives: throw "Illegal invocation" unless called with this === undefined/globalThis.
function strictNatives() {
  const oS = globalThis.setTimeout, oC = globalThis.clearTimeout, oF = globalThis.fetch;
  const guard = (fn) => function (...a) { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); return fn(...a); };
  globalThis.setTimeout = guard(oS); globalThis.clearTimeout = guard(oC); globalThis.fetch = guard(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  return () => { globalThis.setTimeout = oS; globalThis.clearTimeout = oC; globalThis.fetch = oF; };
}

test("batcher default timers work with browser-style unbound natives (debounce + maxWait)", async () => {
  const restore = strictNatives();
  try {
    let n = 0; const b = new Batcher({ debounceMs: 20, maxWaitMs: 60, onFlush: () => n++ });
    b.push(); b.push(); // re-arm => clearTimeout as well
    await new Promise(r => setTimeout(r, 50)); assert.equal(n, 1);
    b.at(Date.now() + 10); await new Promise(r => setTimeout(r, 30)); assert.equal(n, 2);
    b.push(); b.stop(); assert.equal(n, 2);
  } finally { restore(); }
});

test("waitForPosition default timers work with unbound natives", async () => {
  const restore = strictNatives();
  try { const r = await waitForPosition({ id: "t", x: 0, y: 0 }, 5, 5, { on: () => 1, off: () => {}, timeoutMs: 10 }); assert.equal(r.reached, false); }
  finally { restore(); }
});

test("direct delivery default fetch works with unbound native fetch", async () => {
  const restore = strictNatives();
  try {
    const { deliverDirect } = await import("../scripts/lib/direct.mjs");
    const r = await deliverDirect({ batchId: "w:1", events: [{ eventId: "chat:a" }] }, { url: "http://x.invalid/", runCommand: async () => ({ ok: true }), ack: () => {} });
    assert.ok(r && !String(r.error ?? "").includes("Illegal"), JSON.stringify(r));
  } finally { restore(); }
});

test("no source stores a bare native timer/fetch reference", () => {
  const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "node_modules" ? [] : walk(p)) : p.endsWith(".mjs") ? [p] : []; });
  const bad = /=\s*(globalThis\.|window\.)?(setTimeout|clearTimeout|setInterval|clearInterval|fetch|requestAnimationFrame)\s*[,;)}]/;
  for (const f of [...walk("scripts"), ...walk("relay"), ...walk("examples")]) assert.doesNotMatch(readFileSync(f, "utf8"), bad, f);
});

test("dropWhere removes queued events for deleted chat messages", () => {
  const o = new Outbox(); o.enqueue({ eventId: "chat:a", type: "chat" }, 0); o.enqueue({ eventId: "chat:b", type: "chat" }, 0);
  assert.deepEqual(o.dropWhere(e => e.eventId === "chat:a"), ["chat:a"]);
  const b = o.nextBatch(10_000, "w"); assert.deepEqual(b.events.map(e => e.eventId), ["chat:b"]);
});
