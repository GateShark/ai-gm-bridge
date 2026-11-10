# ai-gm-relay

Generic, env-only relay: logs into Foundry headless as your bot's GM user, takes `ai-gm-bridge.events` batches,
POSTs them to your webhook, runs any `commands` in the 2xx response, then acks. Exits doing nothing if the webhook env is unset.
From module v0.8.9 the Foundry side also marks `chat` events received right after emit (so a `/wait`-style consumer does not leave them retrying); you should still ack after 2xx. Re-acking already-received ids is a no-op.

Env (set in your container template; never commit them):
- `AIGM_WEBHOOK_URL`, `AIGM_WEBHOOK_AUTH` (header value), optional `AIGM_WEBHOOK_AUTH_HEADER` (default `Authorization`)
- `FOUNDRY_URL`, `FOUNDRY_RELAY_USER`, `FOUNDRY_RELAY_PASSWORD`, optional `FOUNDRY_EXPECT_WORLD` (refuse any other world)
- `AIGM_RELAY_DATA=/data` (lock, done-set, queue).

```
docker build -t ai-gm-relay ./relay
docker run -d --name ai-gm-relay --restart unless-stopped -v /path/to/relay-data:/data \
  -e AIGM_WEBHOOK_URL=... -e AIGM_WEBHOOK_AUTH=... -e FOUNDRY_URL=... -e FOUNDRY_RELAY_USER=... \
  -e FOUNDRY_RELAY_PASSWORD=... -e FOUNDRY_EXPECT_WORLD=my-world ai-gm-relay
```
Run exactly one relay per world. See docs/BOT-API.md for the payload and command format.

- `AIGM_CONTEXT_JOURNALS` (optional): comma list of GM journal entries or folders. Added to `getContext` commands that don't pass `journals`. It stays in the relay env, never in Foundry.
