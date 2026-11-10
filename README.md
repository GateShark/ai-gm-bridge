# AI GM Bridge (module id `ai-gm-bridge`) v0.8.13

> ⚠️ **Alpha:** still in testing. Expect bugs and breaking changes.

A Foundry VTT module (v13+, verified on v14 build 369) that lets any AI game-master bot run a world. It sends filtered,
batched chat events to your bot's webhook, and your bot sends typed JSON commands back. It is off by default in every world.

## Setup
1. Install the module. Create a GM user for your bot, then enable the module in your world.
2. Open **Settings → Configure AI GM**. Pick the bot GM user, choose delivery (relay or direct), set up the webhook and the filters.
3. Turn on **Enabled**.
4. Run your bot. `docs/BOT-API.md` describes the payload and the commands, and `examples/echo-gm.mjs` is a working example.
   - Relay: see `relay/RUN.md`. It is configured by env only, so the secret never goes into Foundry.
   - Direct: the bot GM's browser POSTs to the webhook. The secret is kept in a world setting, which is write-only in the form.
     Any logged-in user's scripts can still read it, so use the relay for shared worlds.

## At the table (v0.8.8)
- A small status light (bottom right) shows **GM listening**, **GM thinking…**, or **GM offline**. Click it to see when the GM last replied.
- If your browser blocks sound, an **Enable sound** button appears; any click also unlocks voice.
- Push-to-talk: a hold-to-talk mic button (bottom left) with a live mic light. Turn on **Push-to-talk (this browser)** to also use the key (default `` ` ``).
- Roll requests use one large **Roll** button; after you roll, the card greys out.
- Voice lines have a ▶ replay button, and long lines can be expanded.
- The GM has an in-game **AI GM** panel (sidebar robot button): pause or resume the AI, redo or skip the last reply, recap, see whose turn it is, cancel pending rolls, clear stuck events, and a quick HP list.
- **Configure AI GM** now opens a short Basic page (about six settings plus **Test connection**). Everything else is under a collapsed Advanced section.

## What it does
- **Exactly once:** one leader client handles events (the bot GM user is preferred), with persisted dedupe and acked retries.
  A `batchId` always stands for the same set of events.
- **Relay ack (v0.8.13):** in relay mode, player chat, combat start/end, turns, and roll-request outcomes are marked received after they are handed to the relay (socket + hook), so they are not retried. Control events still wait for `api.ack`. Redo/skip fall back to the newest player chat ids when the last wake is unknown.
- **Fewer wakes:** chat bursts are grouped into one batch. Noise is filtered out (OOC, the bot's own posts, plain rolls,
  ignored users). Simple `!` commands are handled locally.
- **Small payloads:** text is plain and trimmed, empty fields are dropped, and combat/scene context is sent only when it changes.
- **Voice:** `postVoice` falls back to text if the audio fails. A voice cache keyed by text hash reuses clips, and `ttsMinChars` skips TTS for short replies.
- **Tokens and files (v0.4):** `lockToken`, `spawnAndVision` (vision and light), `setVision`, and GM-only `upload` into `ai-gm-uploads/`, with size and type limits.
- **Metrics:** `game.modules.get("ai-gm-bridge").api.metrics()`, plus a log line every N batches.

Local commands (no bot call): `!roll 2d6`, `!music <playlist>` or `!music <playlist> stop`, `!scene <name>`,
`!hp <actor> -2`, `!luck <actor> 3`, `!prayers <actor> -1`. Players can only change actors they own. `!music` and `!scene` are GM only.

- Pirate Borg morale checks and ship combat helpers (system rules, no dialogs), see docs/BOT-API.md.

- **Push-to-talk (v0.8.5, per player, off by default):** each player enables **Push-to-talk (this browser)** (`pushToTalk`, client setting) and holds the key (`pushToTalkKey`, default `Backquote`, the ` key) or the 🎤 button bottom-left. The browser's Web Speech API transcribes (language from Foundry's language setting) with a "Listening…" indicator showing live text; on release the transcript is posted as that player's normal chat message. The key is ignored while typing in a text field. Chrome/Edge only (no Firefox: one-time notice, no button); needs mic permission, which browsers allow only on HTTPS or localhost. Speech goes to the browser's own speech service (Chrome/Edge send audio to Google/Microsoft), nothing to this module's servers.

## API (bot GM user, on the leader client)
`api.run({name, args, commandId?})`, `api.ack(eventIds)`, `api.status()`, `api.metrics()`, `api.clearDead()`, `api.clearStuck()`.
See `docs/BOT-API.md`.

## Release
`node tools/set-release.mjs https://github.com/OWNER/REPO` fills in `url`, `manifest` and `download`. Until you run it,
they are `example.invalid` placeholders. Tests: `npm test`.

## Known limits
- Voice: before 0.8.1, bot voice lines could be missed by players (e.g. playing as a player user rather than the GM). Since 0.8.1 voice is sent to every client over the module socket and played locally; confirmed playing on a player client. Browsers may need one click to allow audio.
- Push-to-talk (optional, off by default) uses the Web Speech API: Chrome/Edge only, and the page must be HTTPS or localhost.
- Foundry sends GM-only journals (even ownership None) and all world settings to every player's browser. A tech-savvy player can read them from the console. The module therefore stores nothing secret in the world: the bot names the journals it wants per `getContext` call, or the relay adds `AIGM_CONTEXT_JOURNALS` from its own environment. The context text is returned only to the bot, and its cache is in memory on the GM client.
- The secret content itself (GM journals, hidden tokens) is still in the world and therefore reaches players' browsers. That is Foundry's behaviour, not something a module can change.
- Morale and ship commands load the pirateborg system's own files (tested with pirateborg v1.9.0). If a system update moves them, these commands return an error; everything else keeps working. Ship targets must be tokens on the scene the GM client is viewing.

## Install
In Foundry, Add-on Modules → Install Module, paste this manifest URL:
`https://github.com/GateShark/ai-gm-bridge/releases/latest/download/module.json`

## Credits
Created by Gate (GateShark). MIT licensed, see LICENSE.
