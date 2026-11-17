// Direct delivery (no relay): the bot GM's own browser POSTs the batch to the webhook. 2xx → run returned commands → ack.
import { isLocalNetworkUrl, lnaFetchOptions } from "./localnet.mjs";
// The webhook must allow CORS from the Foundry origin. Never logs the secret.
export async function deliverDirect(payload, { url, secret, header = "Authorization", fetchImpl = (...a) => globalThis.fetch(...a), runCommand, ack }) {
  if (!url) return { ok: false, error: "no webhook url" };
  let r; try {
    r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { [header]: secret } : {}), "idempotency-key": payload.batchId }, body: JSON.stringify(payload), ...lnaFetchOptions(url) });
  } catch (e) {
    const msg = String(e?.message ?? e).split(secret || "\u0000").join("[redacted]");
    // 0.9.4: a private or loopback webhook that fails like this is most likely blocked by the browser (Local Network Access).
    return { ok: false, error: e instanceof TypeError && isLocalNetworkUrl(url) ? `${msg} (local-network webhook: the browser may be blocking it; use a public https URL, allow local-network access, or use relay)` : msg };
  }
  if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status };
  let cmds = []; try { cmds = JSON.parse(await r.text())?.commands ?? []; } catch { cmds = []; }
  const results = [];
  for (const [i, c] of (Array.isArray(cmds) ? cmds : []).slice(0, 20).entries()) results.push(await runCommand({ ...c, commandId: c.commandId ?? `${payload.batchId}:${i}` }));
  await ack(payload.events.map(e => e.eventId));
  return { ok: true, status: r.status, results };
}
