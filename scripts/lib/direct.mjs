// Direct delivery (no relay): the bot GM's own browser POSTs the batch to the webhook. 2xx → run returned commands → ack.
// The webhook must allow CORS from the Foundry origin. Never logs the secret.
export async function deliverDirect(payload, { url, secret, header = "Authorization", fetchImpl = (...a) => globalThis.fetch(...a), runCommand, ack }) {
  if (!url) return { ok: false, error: "no webhook url" };
  let r; try {
    r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { [header]: secret } : {}), "idempotency-key": payload.batchId }, body: JSON.stringify(payload) });
  } catch (e) { return { ok: false, error: String(e?.message ?? e).split(secret || "\u0000").join("[redacted]") }; }
  if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status };
  let cmds = []; try { cmds = JSON.parse(await r.text())?.commands ?? []; } catch { cmds = []; }
  const results = [];
  for (const [i, c] of (Array.isArray(cmds) ? cmds : []).slice(0, 20).entries()) results.push(await runCommand({ ...c, commandId: c.commandId ?? `${payload.batchId}:${i}` }));
  await ack(payload.events.map(e => e.eventId));
  return { ok: true, status: r.status, results };
}
