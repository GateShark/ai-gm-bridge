<p align="center">
  <img src="assets/logo-256.webp" alt="AI GM Pirate Borg" width="160" height="160" />
</p>

# AI GM Pirate Borg (module id `ai-gm-bridge`) v0.8.19

> ⚠️ **Alpha:** this is still in testing. Expect bugs and breaking changes.

Previously called AI GM Bridge. The module id is still `ai-gm-bridge`.

A Foundry VTT module (v13+, verified on v14 build 369) that lets any AI game-master bot run a world. It sends filtered,
batched chat events to your bot's webhook, and your bot sends typed JSON commands back. It is off by default in every world.

Created by Gate (GateShark).

## Setup
1. Install the module. Create a GM user for your bot, then enable the module in your world.
2. Open **Settings → Configure AI GM Pirate Borg**. Pick the bot GM user, choose delivery (relay or direct), set up the webhook and the filters.
3. Turn on **Enabled**.
4. Run your bot. `docs/BOT-API.md` describes the payload and the commands, and `examples/echo-gm.mjs` is a working example.
   - Relay: see `relay/RUN.md`. It is configured by env only, so the secret never goes into Foundry.
   - Direct: the bot GM's browser POSTs to the webhook. The secret is kept in a world setting, which is write-only in the form.
     Any logged-in user's scripts can still read it, so use the relay for shared worlds.

## At the table
- A small status light (bottom right) shows what the GM is doing in plain words: **GM listening**, **GM waking up**, **GM reading**, **GM thinking…**, **GM requesting a roll**, **GM is sending a voice message…**, **GM speaking**, **GM asleep**, **AI GM offline** (with time since last seen), or **GM paused**. Active states can show how many seconds they have lasted. Click the pill to see when the GM last replied.
- If your browser blocks sound, an **Enable sound** button appears; any click or key also unlocks voice.
- Push-to-talk: a hold-to-talk logo button (bottom left, drag to move; the spot is remembered in this browser) with a live light. Turn on **Push-to-talk (this browser)** to also use the key (default `` ` ``).
- Roll requests use one large **Roll** button; after you roll, cancel, or the request expires, the card greys out.
- Voice lines have a ▶ replay button, and long lines can be expanded.
- The GM has an in-game **AI GM Pirate Borg** panel (sidebar robot button): pause or resume the AI, redo or skip the last reply, recap (newest first), see whose turn it is, cancel pending rolls, clear stuck events, check setup, a quick HP list, session save/resume, Start game / Pause game, and Quick GM buttons (roll a table, give loot, apply damage, start a ship fight).
- **Configure AI GM Pirate Borg** opens a short Basic page (about six settings plus **Test connection**). Everything else is under a collapsed Advanced section. Test connection also reports any setup warnings (player-looking characters with no player owner).

## What's new since 0.8.0 (0.8.1–0.8.19)
These versions add table tools, more reliable combat, and fewer wasted bot calls. The current release is **0.8.19**.

**Replay, volume, captions, mood, morale, and loot (0.8.19)**
- Every voiced GM line has a ▶ replay button. It plays that player's chosen recorded voice on their computer only and does not wake the bot.
- Each player sets **GM voice volume** (0–100%, default 80%) on the Basic page. It applies to GM voice, previews, and Your-turn clips, separate from Foundry's music and ambience.
- **Big captions** (off by default) show the current spoken line in large text near the bottom of the screen while the clip plays, then clear. They do not block the map.
- `setMood` plays a mapped Foundry playlist for combat, storm, tavern, explore, tense, calm, or none, and can follow combat automatically. No music files are bundled; a missing playlist is reported and nothing plays.
- `moraleCheck` can check one creature, several tokens, or every living hostile in combat. Morale is read from `system.attributes.morale`. A value of `-` or none means the creature never breaks. The bot can get a `moralePrompt` wake when the first enemy dies or half the enemies are down (no automatic roll).
- When a fight ends, the combat end event includes defeated enemies and PCs (`combatEnded`) so the bot can call `giveLoot` or `rollLoot`. `rollLoot` draws official-style loot/treasure tables (world or compendium) and puts items or silver on sheets.

**Recorded voices per player (0.8.18)**
- Each player picks the GM voice they hear (Ryan, Thomas, Sonia, or Aria) on the Basic settings page. Play sample (and changing the dropdown) plays a bundled preview only on that computer. The pick is stored as that user's `gmVoice` flag; `voicePrefs` lists everyone's choice.
- Your-turn and spoken replies use recorded clips only (no browser speech). Files are named `turn-<name>-<voice>.mp3`. If a clip is missing: that PC in the chosen voice, then generic in the chosen voice, then that PC in Ryan, then generic Ryan, then text only.
- Voice messages can send an `audio` map keyed by voice slug so each client hears their pick (falling back to Ryan). Speech-to-text also corrects "pulled up behind" → "ducked behind".

**Player-visible status, faster rolls, and the display name (0.8.17)**
- Display title is now **AI GM Pirate Borg** (the module id is still `ai-gm-bridge`).
- Ability-test rolls wake the bot immediately. Players see **GM waking up** / **GM reading** / **GM thinking…** / **GM is sending a voice message…** / **GM speaking** instead of waiting in silence. The bot can set thinking or voicing with `setGmStatus`.
- One reply and one roll card per event; extra roll cards can be cancelled. Timed-out cards keep the player Roll button. `requestRoll` accepts `d4` / `1d4` (for example Broken).
- The push-to-talk button uses the logo and can be dragged. A small speech-correction list fixes combat words such as kick / dropkick.
- "Your turn" is spoken out loud by default (browser speech, no extra bot call).

**Session recap and command targets (v0.8.16)**
- Session recap lists only player characters and pets (monster HP such as "Skeleton 2 0/4" is omitted). PCs and pets are kept first if a busy scene hits the snapshot cap.
- **Clear stuck** drops held start/pause `control` events too, and updates the queue on every GM client (not only the leader).
- After a debug offline-light test is cancelled or expires, the bot writes a nonce immediately so the light can go green without waiting for the next 30-second refresh. No extra idle polling was added.
- `applyDamage` and `giveLoot` accept the same target shapes (`tokenId` / `tokenName` / `tokenIds` and `actorId` / `actorName` / `actorIds`). Older call shapes still work.

**Session, pets, and ships (0.8.15)**
- Save a compact "where we left off" snapshot (scene, HP, a few key items, open GM notes) and get a spoiler-free recap when you resume. Pets marked with an owner flag can be placed next to their owner; a house-rule note can remind the table that a pet takes one simple action.
- **Start game** unpauses Foundry and wakes the AI GM; **Pause game** pauses Foundry and tells the AI GM to stop so queued work does not run.
- Quick GM buttons roll a world table, give drawn loot to a selected token, apply damage to selected tokens, or start a ship fight. Ship combatants add hull/crew to the fight roster; crew actions this round are tracked in memory without changing Pirate Borg system data.

**Combat and turns**
- Immediate combat start and end events, so the bot can stay with a fight.
- By default the bot is woken only for NPC or monster turns. Player-character turns stay local. `turnStatus` and those turn events now use the same ownership rules, including unlinked player-owned tokens.
- `turnStatus` returns a ready-made `expect` object to pass straight to `nextTurn`. Missing or stale values explain who is actually up.
- Combat start includes a compact roster (name, HP, whether each combatant is a PC or NPC, and the owner when known) and a warning if a pirate-looking character has no player owner and would be treated as a monster.
- When a player-owned character's HP drops to 0 or below, the bot receives a one-time `pcDown` event. It can fire again only after that character is healed above 0.
- Ending a combat cancels pending roll requests tied to that fight (for example defence reminders).
- A setup check (`setupCheck`, the panel **Check setup** button, Test connection, or `!setup`) lists those unowned pirate-looking characters. It only warns; it never changes the world.

**Reliability and usage**
- A `ping` command writes a tiny nonce to a world setting and only reports OK when Foundry reads the same value back (about 5 seconds, then a clear timeout). `turnStatus` and Test connection also show that last-seen time and whether the AI GM user is logged in, without extra AI calls.
- The status light and AI GM panel show **AI GM offline** (with time since last seen) after a configurable wait (default 60 seconds) with no server-confirmed sighting. Commands fail quickly if this page is not logged in, or time out instead of hanging if the socket has dropped.
- The setup-check banner refreshes when tokens or actors are created, updated, or deleted, so it clears as soon as an unowned pirate is removed.
- Official logo (a d20 with eyes) in the module listing, the README, and the in-game AI GM panel header.
- In relay mode, chat, combat, turns, roll outcomes, `pcDown`, and `shipCombat` are marked received after they are handed to the relay, so they do not pile up in the outbox. Control events (pause, resume, redo, skip) still wait for an explicit ack.
- HP, resources, and rest prefer the token on the viewed scene, so unlinked tokens use their own stats instead of the base actor sheet.
- Pirate Borg HP is read from `system.attributes.hp`. Player-owned characters are labeled as PCs even if the token looks hostile.
- Rest accepts `kind` as an alias for `length`, rejects unknown rest types instead of silently taking a long rest, and does not restore rituals or class resources when the character has none.
- Redo and skip fall back to the newest player chat when the last wake is unknown (for example after a reload).

**Voice, audio, and input**
- Bot voice is sent to every client over the module socket and played locally. Failed clips are retried; a blocked autoplay queue resumes after a click, a keypress, or returning to the tab.
- Optional push-to-talk (off by default, per browser) transcribes with the Web Speech API.
- Known issue: voice may not be heard when the GM plays a character as a player. This needs more testing.

**Other commands and helpers**
- `requestRoll` can take any Foundry formula, not only ability tests.
- `move` retries as a displace if the first attempt does not arrive; `setBackground` writes Foundry v14's scene level background; `format` turns a command reply into one readable line.
- JSON wrapped as `{"text":"..."}` is unwrapped before posting or voicing.

See `CHANGELOG.md` for the version-by-version list.

## What it does
- **Exactly once:** one leader client handles events (the bot GM user is preferred), with persisted dedupe and acked retries.
  A `batchId` always stands for the same set of events.
- **Relay ack:** in relay mode, player chat, combat start/end, turns, roll-request outcomes, `pcDown`, and `shipCombat` are marked received after they are handed to the relay (socket + hook), so they are not retried. Control events still wait for `api.ack`. Redo/skip fall back to the newest player chat ids when the last wake is unknown.
- **Fewer wakes:** chat bursts are grouped into one batch. Noise is filtered out (OOC, the bot's own posts, plain rolls,
  ignored users). Simple `!` commands are handled locally.
- **Small payloads:** text is plain and trimmed, empty fields are dropped, and combat/scene context is sent only when it changes.
- **Voice:** `postVoice` falls back to text if the audio fails. A voice cache keyed by text hash reuses clips, and `ttsMinChars` skips TTS for short replies.
- **Tokens and files (v0.4):** `lockToken`, `spawnAndVision` (vision and light), `setVision`, and GM-only `upload` into `ai-gm-uploads/`, with size and type limits.
- **Metrics:** `game.modules.get("ai-gm-bridge").api.metrics()`, plus a log line every N batches.

Local commands (no bot call): `!roll 2d6`, `!music <playlist>` or `!music <playlist> stop`, `!scene <name>`,
`!hp <actor> -2`, `!luck <actor> 3`, `!prayers <actor> -1`, `!turn`, `!setup`, `!rest <actor> [short|long]`, `!save [notes]`, `!load`, `!start`, `!pause`.
Players can only change actors they own. `!music`, `!scene`, `!setup`, session save/load, start/pause, tables, and ship helpers are GM only.

- Pirate Borg morale checks and ship combat helpers (system rules, no dialogs), see docs/BOT-API.md.

- **Push-to-talk (v0.8.5, per player, off by default):** each player enables **Push-to-talk (this browser)** (`pushToTalk`, client setting) and holds the key (`pushToTalkKey`, default `Backquote`, the ` key) or the logo button (bottom left; drag to move). The browser's Web Speech API transcribes (language from Foundry's language setting) with a "Listening…" indicator showing live text; on release the transcript is posted as that player's normal chat message. The key is ignored while typing in a text field. Chrome/Edge only (no Firefox: one-time notice, no button); needs mic permission, which browsers allow only on HTTPS or localhost. Speech goes to the browser's own speech service (Chrome/Edge send audio to Google/Microsoft), nothing to this module's servers.

## API (bot GM user, on the leader client)
`api.run({name, args, commandId?})`, `api.ack(eventIds)`, `api.status()`, `api.metrics()`, `api.clearDead()`, `api.clearStuck()`, `api.setupCheck()`, `api.turnStatus()`, `api.ping()`, `api.recap()`.
See `docs/BOT-API.md`.

## Release
`module.json` already points at this repository's GitHub Releases:
`url` is the repo, and `manifest` / `download` use `releases/latest/download/module.json` and `module.zip`
(the same convention as earlier public builds). `node tools/set-release.mjs https://github.com/OWNER/REPO` rewrites those fields if you fork the project.
Tests: `npm test`.

## Known limits
- This is an **alpha** build. Expect bugs and breaking changes.
- Voice may not be heard when the GM plays a character as a player. This needs more testing. Browsers may also need one click (or the **Enable sound** button) before audio will play.
- Push-to-talk (optional, off by default) uses the Web Speech API: Chrome/Edge only, and the page must be HTTPS or localhost.
- Foundry sends GM-only journals (even ownership None) and all world settings to every player's browser. A tech-savvy player can read them from the console. The module therefore stores nothing secret in the world: the bot names the journals it wants per `getContext` call, or the relay adds `AIGM_CONTEXT_JOURNALS` from its own environment. The context text is returned only to the bot, and its cache is in memory on the GM client. Session notes live in one overwritten world setting (`sessionSnapshot`) with the same limit — the spoiler-free recap text omits them, but the stored notes are still world data.
- The secret content itself (GM journals, hidden tokens) is still in the world and therefore reaches players' browsers. That is Foundry's behaviour, not something a module can change.
- Morale and ship commands load the pirateborg system's own files (tested with pirateborg v1.9.0). If a system update moves them, these commands return an error; everything else keeps working. Ship targets must be tokens on the scene the GM client is viewing.

## Install
In Foundry, Add-on Modules → Install Module, paste this manifest URL:
`https://github.com/GateShark/ai-gm-bridge/releases/latest/download/module.json`

## Credits
Created by Gate (GateShark). MIT licensed, see LICENSE.
