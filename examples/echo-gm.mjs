// Minimal AI GM webhook: echoes chat back into Foundry. Replace reply() with your model call.
// Run: AIGM_WEBHOOK_AUTH=change-me PORT=8787 node examples/echo-gm.mjs
// Then point the relay (AIGM_WEBHOOK_URL=http://host:8787/events) or the module's direct mode at it.
import http from "node:http";

const SECRET = process.env.AIGM_WEBHOOK_AUTH;
const PORT = Number(process.env.PORT || 8787);
const seen = new Set(); // idempotency: one reply per batch

function reply(ev, ctx) {
  if (ev.type === "turn") return { name: "post", args: { content: `${ev.combatant ?? "Someone"}, you're up.` } };
  if (ev.type !== "chat" || !ev.text) return null;
  const where = ctx?.scene ? ` (in ${ctx.scene})` : "";
  return { name: "post", args: { content: `Echo${where}: ${ev.text}`, replyTo: ev.eventId } };
}

export function handle(payload) {
  if (seen.has(payload.batchId)) return { commands: [] };
  seen.add(payload.batchId);
  return { commands: (payload.events ?? []).map(e => reply(e, payload.ctx)).filter(Boolean) };
}

export const server = http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  if (!SECRET || req.headers.authorization !== SECRET) { res.writeHead(401).end(); return; }
  let body = "";
  req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    let payload; try { payload = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(handle(payload)));
  });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!SECRET) { console.error("set AIGM_WEBHOOK_AUTH"); process.exit(1); }
  server.listen(PORT, () => console.log(`echo GM listening on :${PORT}`));
}
