# Changelog

## 0.8.11
- `turnWake` now defaults on and only wakes the bot for NPC/monster turns (never for player-character turns). The setting is labeled **Wake on NPC/monster turns**. Worlds that already saved the setting stay as they are (an explicit off is not flipped on); worlds that never stored a value pick up the new default.
- `turnStatus` returns a ready-made `expect: {combatId, round, turn}` to pass straight to `nextTurn`. Missing or stale `expect` errors now say what the current combatant and round/turn actually are.
- Ending or deleting a combat still emits the existing `combat`/`end` event, and any pending roll requests stamped with that combat (defence reminders) are auto-cancelled so they cannot time out afterward.

## 0.8.10
- Game summary (`getContext`): HP is read from Pirate Borg's live `system.attributes.hp` (falling back to `system.hp`, then the `hpPath` setting). The default `hpPath` is now `system.attributes.hp.value`. Worlds still saved as the stale `system.hp.value` are migrated on ready. Player-owned or `character` tokens are always labeled as PCs, even when their token disposition is hostile.
- Resource reads, rest, and other actor-targeted commands prefer the viewed scene token's actor when the caller only passed `actorId`/`actorName`, so unlinked tokens (like a wounded Tempus at 2/10) are used instead of the base sheet.
- Rest: `kind` is accepted as an alias for `length`. Unknown or malformed rest types are rejected with "length must be short or long" instead of silently doing a long rest. Rituals, slots, and other class resources are not restored when the actor has none (`max` is 0).
- GM panel: **Clear stuck** empties un-acked and dead outbox events (with a confirm and a toast of how many were cleared). The panel shows the stuck count. Non-leader GMs forward the clear to the leader so it is persisted.
- Relay mode now also marks `combat`, `turn`, `rollResult`, `rollTimeout`, and `rollCancelled` received after emit, so those events do not sit in the queue until they die. `control` still waits for an explicit `api.ack`.

## 0.8.9
- Relay mode: chat events are marked received after the batch is emitted on the module socket and the `ai-gm-bridge.events` hook, so they are not retried. Relays that read Foundry chat themselves (for example a `/wait` loop) no longer leave player chat sitting in the outbox until it dies. Other event types still wait for `api.ack` (the official relay still acks after webhook 2xx). Direct delivery is unchanged (ack after 2xx). Chat that was already flushed at least once is also acked when the leader starts up, so old unacked chat does not re-send after a reload.
- Redo/skip: if the last wake ids are empty (for example after a reload), the control event falls back to the newest player chat event ids instead of sending `targetEventIds: []`.
- Panel HP list reads tokens on the viewed scene (`token.actor`), so unlinked tokens show their own HP (including 0) and off-scene actors are omitted.
- The pending-rolls list in an open GM panel refreshes when a roll is requested, rolled, cancelled, or expires.
- Settings labels for delivery, webhook URL, bot names, and webhook auth header are localized (they no longer show raw i18n keys).
- Recap lists the newest lines first and stamps each line with Today, Yesterday, or the date, plus the time.


## 0.8.8
- Settings: Configure AI GM now has a short Basic page (Enabled, bot GM user, webhook URL/secret, voice-for-players, push-to-talk key, combat events) plus a **Test connection** button, and a collapsed Advanced section for the rest. Existing setting keys and defaults are unchanged; internal state (dedupe, outbox, voice cache, notices) stays hidden. World settings no longer fill Foundry's long module-settings list.
- Everyone sees a floating GM status light: green "GM listening", amber "GM thinking…", red "GM offline" (and grey "GM paused"). Click it for the time of the last reply. It reuses the existing heartbeat and thinking events (no extra polling of the AI).
- Players: an **Enable sound** toast if the browser is blocking audio; a clearer hold-to-talk mic button with a live mic light (the button is shown whenever the browser supports speech recognition; the keyboard shortcut still needs the push-to-talk setting); roll-request cards have one large Roll button and grey out after rolling.
- GM panel (sidebar robot button, GM only): pause and resume the AI GM, redo or skip the last reply, recap, current turn, cancel pending roll requests, and a quick HP list.
- Chat: each GM voice line has a small ▶ replay button; long lines collapse behind Show more.
- Additive bot events (old bots can ignore them): `{type:"control", action:"pause"|"resume"|"redo"|"skip", targetEventIds?, replyTo?}` and `{type:"rollCancelled", requestId}`. New command `cancelRoll {requestId}`. New world setting `aiPaused` (default off).
- Tests for the new settings layout, status light, panel, voice chrome, connection test and cancel/roll helpers.


## 0.8.7
- Audio: any click/keypress, or returning to the Foundry tab, now resumes voice blocked by the browser's autoplay policy (after a reload or while the tab was in the background); the "Click to enable audio" button still appears.
- Grey map: on scene load the GM gets a warning if the scene has no background image or the file is missing (checks the v14 level background first, then the scene's).
- GM text that arrives as a JSON string like `{"text":"..."}` is unwrapped before posting/voicing (post, postVoice, whisper, speakBubble).
- `api.ready` / `api.whenReady()`: a stub API exists from `init`, so macros that run early can `await game.modules.get("ai-gm-bridge").api.whenReady()` instead of failing. Removed the stale hardcoded "v0.8.0" header; version comes only from module.json.

## 0.8.6
- "GM is thinking…" pill now clears on every client when the bot acks events or clears dead events (broadcast), when a combat ends or is deleted, and on any bot chat message or command (as before).
- Pill timeout runs from the first show: queued player messages no longer push the 90 s deadline out (shorter timeouts still win).
- Roll results show raw dice and modifier: `rollResult` events, chat-event `rolls[]`, roll-request cards and answer notes gain `breakdown` (e.g. `d20 19 + 1 = 20`), `dice` and `modifier`. Existing fields (`total`, `natural`, `success`…) unchanged.

## 0.8.5
- Optional push-to-talk: client settings `pushToTalk` (default off) and `pushToTalkKey` (default `Backquote`), plus a hold-to-talk mic button. Web Speech API transcript with a live "Listening…" indicator, posted on release as the player's own chat message. Ignored while typing; one-time notice when the API is missing (Firefox).

## 0.8.4
- #15: `requestRoll` takes `formula` (any Foundry formula, e.g. `1d6`, `2d4+1`, `1d20+@abilities.agility.value`) with `label`; `stat`/`dr` optional then. Same clickable card button; `rollResult` adds `formula`/`label`, `success` null without `dr`. d20 stat tests unchanged.

## 0.8.3
- New immediate (non-debounced) `combat` events `{type:"combat", state:"start"|"end", combatId, sceneId, round, combatants}` on combat start (`combatStart` / `updateCombat` round 1) and end (`deleteCombat`). Leader-only, deduped per combat. Setting `combatEvents` (default on).
- `turnWake` turn events (still default off) are now sent immediately instead of debounced.

## 0.8.2
- Fix: `setHP` (and `setResource`, `getResources`, `shipDamage`, `getShip`, `rest`) accept `tokenId`/`tokenName`; unlinked tokens (`actorLink:false`) are written through `token.actor` instead of the base actor. Linked tokens and actor-only calls are unchanged.
- New "GM is thinking…" indicator: a bottom-right pill on every client (module socket, not a chat message) after a player message or roll is sent to the bot; cleared by the bot's next chat message, voice line or command, or after `thinkingTimeoutMs` (default 90 s). `thinkingIndicator` setting (default on). Localized as `AIGM.thinking`.

## 0.8.1
- `move`: when the normal update doesn't reach the target (504), retry once with `TokenDocument.move` action `displace` and `constrainOptions {ignoreWalls, ignoreCost}`; replies add `via:"displace"` when used.
- New `setBackground` command: Foundry v14 writes `scene.levels.contents[0]` `background.src`; older versions fall back to the scene.
- New `format` command and `api.format(reply)`: one readable line from a `{ok,result}` reply, so bots don't post raw JSON or `[object Object]`.
- `shipAction ram` with `ramUsesArmor` off reports the rolled armour as `armorRoll` (not `armor`); `armor` means it was subtracted.
- Docs: reading replies, the voice path (voiceLookup, your TTS, upload, postVoice), why `!` shortcuts typed by the bot user are ignored, burst grouping.
- Audio queue: a clip that fails to play (e.g. collided with a dice sound) is retried up to 2 times with backoff instead of being dropped.
- Audio autoplay: if the browser blocks autoplay (new session/relog), the queue pauses and shows a one-time "Click to enable audio" button; clicking unlocks audio and replays the held clip, then the rest in order.
- Tests: burst retest (events closer than debounceMs group into one batch), move fallback, background, format.

## 0.8.0
- First public release, by Gate (GateShark). Module id is now `ai-gm-bridge`; relay reads `AIGM_*` env vars only.

## 0.8.0-rc2
- Ram matches the pirateborg system by default; `ramUsesArmor` house-rule setting. Test fixtures scrubbed of private names.

## 0.8.0-rc1
- Context diff: removed sections are listed only in `removed`, not also in `changed`.
- Pirate Borg morale and ship combat: `moraleCheck`, `shipAction` (broadsides, small arms, ram, repair, full sail, come about, anchors, shanty, sinking), `shipDamage`, `getShip`, plus `!morale`, `!ship` and `!<action>` shortcuts. Uses the system's own outcome builders and chat card without dialogs; our cards never wake the bot.
- Ram matches the pirateborg system by default (target armor rolled but not subtracted). New world setting `ramUsesArmor` (default off) is a house rule that subtracts it.
- Release candidate: tested only in one test world.

## 0.7.2
- Fix: payload `prune()` dropped `false` (and `[]`), so rollResult lost `success:false`, `crit:false`, `fumble:false`. It now drops only null, undefined and "" (0, false and [] survive). No other payload code strips falsy values; the remaining `|| undefined` / `filter(Boolean)` uses are on strings or optional flags, not payload values.
- No secrets in client-synced data: Foundry v14 sends every journal (even ownership None) and world setting to player browsers. The context journal list is no longer stored in the world: the bot passes `journals` per `getContext` call (entry, "Entry/Page" or folder names), or the relay adds `AIGM_CONTEXT_JOURNALS` from its environment when the bot passes none. The GM form field is removed. On load the GM clears the old `contextJournals` setting and removes the v0.7.1 "AI GM Config" journal (deleted if empty, else its flag is unset); the old value is logged to the GM console once.
- Context cache is memory-only on the GM client (no flags, settings or documents), with a test that audits this.
- Per-journal diffs: each journal entry is its own section (`journal:<name>`) with its own hash; only changed scene/combat/tokens/journal sections are resent, and dropped ones are listed in `removed`.
- README: Known limits.

## 0.7.1
- No spoilers: the context journal list moved out of world settings (which every client can read) into a flag on a dedicated GM-only JournalEntry "AI GM Config" (ownership default NONE; re-locked if someone opens it). It is edited in the GM settings form.
- On load, the active GM migrates a v0.7.0 `contextJournals` setting value into the journal and clears the setting (the setting stays registered, hidden and empty).

## 0.7.0
- rollResult always has `success`, `crit` and `fumble` as booleans (never omitted; a missing total/DR gives success:false).
- GM-only context: `getContext` command and `api.context({scene, journals, maxChars, since, full})`. Returns compact plain text: scene name and notes (scene journal page + map-note labels), journal pages (stripped HTML, truncated), visible and hidden tokens with HP, active combat order.
  - Only returned to the caller (bot webhook command response or GM api). Never posted to chat, whispered, emitted on the socket, or rendered. Non-GM callers get 403.
  - New world setting `contextJournals`: journal entry or folder names/ids to always include (subfolders included).
  - Cached and diff-based: a short `hash`; `{since: hash}` or an unchanged repeat returns `{unchanged:true}`; otherwise only changed sections (`changed`, `removed`) unless `full:true` or the bot's hash is stale.

## 0.6.1
- setHP accepts `delta` (number or "+3"/"-2" string) or `value`; a +/- string in `value` is treated as a delta. Clamped to max like setResource.
- Roll matching handles Pirate Borg sheet rolls: they carry no `message.rolls`; the roll is read from `flags.pirateborg.outcomes[].roll` and the ability from the outcome formula (`@abilities.X`).
- Several open cards: match the roll's speaker actor first, then the ability, then oldest. A roll for an ability with no open card answers nothing.
- Cards expire (`rollRequestExpireMs`, default 10 min after timeout) and are marked Expired.
- The answered card shows how it was answered; a small chat note names the card (`rollAnswerNote`). The rollResult event has `via`.
- The rest report includes the per-day rolls (formula=total) for extra resource, rituals and luck.

## 0.6.0
- Burst cap default is now 3.5 s (`maxWaitMs` 3500, still configurable).
- requestRoll: a clickable test card for one player (or a GM). It accepts the button roll, a sheet roll or Pixels dice. Idempotent requestId, a single urgent rollResult event, and on timeout a rollTimeout event plus a GM fallback button.
- Combat turn prompts in Foundry with no wakes: a chat line, a notification to the owner, and optional per-user voice (a cached clip or browser speech). Adds api.turnStatus(), the turnStatus command and !turn. Turn events now reach the bot only when `turnWake` is on.
- Session log: GM-only journal "AI GM Session Log" with damage, heals, 0 HP, items, resources, combat start/end and rests. Adds api.recap({since}) and the recap command.
- Pirate Borg rest: the rest command and !rest, following the system rules and reusing its per-day and grog functions.
- speakBubble: an NPC chat bubble on a token, broadcast to all clients.
- Tests: test/v06.test.mjs (27).

## 0.5.0
- Cap hardening: the 4 s cap is measured from each event's enqueue time (`push({at})`), the earliest pending event wins, and events left unsent after a flush (because of batchMax or a retry wake) are re-armed with their original time. If the cap is already reached when an event arrives, the batch is sent immediately instead of through a 0 ms timer. The heartbeat also enforces the cap, since browsers throttle timers in background tabs. Sends never wait for an ack: they are emitted in parallel.
- metrics holdMaxMs (longest time an event waited before its first send).
- api.debug.burstTest({count, gapMs | [min,max], ackAfterMs, seed}): a headless timing harness (no ChatMessages, mock sink). Returns batch sizes, send times, holds and maxHoldMs.
- Tests: test/v05.test.mjs (27): 25 seeded 1.1-2.3 s jitter runs x 3 ack latencies, max hold <= 4.05 s; 9 @ 800 ms -> 5+4; cap from the earliest event, synchronous fire, heartbeat catch-up.

## 0.4.0
- lockToken: scope move or all; enforced in preUpdateToken on every client (GMs exempt) and through core `locked`.
- upload: GM-only base64 upload to ai-gm-uploads/<kind>/; settings for on/off, MB limit and types; magic-byte check; content-hash names (no duplicate uploads).
- spawnAndVision: place an actor token with clamped sight/light, optional lock, idempotent spawnKey. setVision for existing tokens.
- Fix (grouping after a flush): the retry/backoff wake shared the burst timer, so an in-flight batch's 2 s retry wake fired mid-burst and sent fresh events one by one. Retries now use a separate timer, and a retry wake while a burst is still grouping sends only retries. nextDueAt counts only sent items. Each burst gets a fresh 1.2 s quiet window and a 4 s cap from its own first event.
- Tests: test/v04.test.mjs (5), test/v04-burst.test.mjs (4; reproduces 9 messages 800 ms apart -> 5+4).

## 0.3.1
- Fix (blocker): Batcher stored native setTimeout/clearTimeout and called them as methods -> browser "Illegal invocation"; debounce/maxWait/retry timers never fired. Now arrow wrappers. Same hardening for movewait timers, direct/relay fetch, relay log.
- Drop queued events whose chat message was deleted (deleteChatMessage hook + check before each send; metric dropDeleted).
- Tests: browser-style strict natives (batcher, movewait, direct fetch), source scan for bare native refs, dropWhere.

## 0.3.0 (2026-11-02): speed and usage
- Event-driven batching: chat bursts debounced (debounceMs 1200, maxWaitMs 4000) into one batch = one bot wake; mentions/whispers flush at once.
  The flush interval timer is gone; retries are scheduled at their exact due time. Heartbeat is the only interval left.
- Configurable filter (wakeOn, ignoreOOC, ignorePlainRolls, ignoreUsers, minChars) with reasons counted in metrics.
- Local commands (no bot call): !roll, !r, !music <playlist> [stop], !scene, !hp/!luck/!rituals/!prayers <actor> <±n|n>. Players only for actors they own; music/scene GM-only.
- Compact payloads: HTML stripped, text trimmed (maxTextChars), empty fields dropped, ids/flags the bot doesn't need removed; combat/scene/paused sent as a ctx diff against the last acked batch.
- Voice: cache of mp3 per normalized text hash (voiceLookup, postVoice reuses cached clip), ttsMinChars posts short replies as text.
- Metrics: api.metrics() and a log line every metricsLogEvery batches (seen, woke, wakes, local, filtered by reason, bytes, events/wake, queue/ack/reply p50/p95).
- Fix: move awaits v14 async movement (updateToken hook) and returns the final x,y, or 504 if the token never arrives.
- Fix: batchId = world + hash of the exact event set; a batchId never carries a different set.
- Bot-agnostic: titled "AI GM Bridge", neutral text, no hardcoded bot user name (pick one in the form), botNames setting for bot user names.
- GM-only settings form (Configure AI GM): bot user picker, delivery relay/direct, webhook URL + auth header, write-only secret, filters.
- Direct delivery mode (bot GM browser POSTs). Webhook 2xx responses may return {commands:[...]}; they run (commandId batchId:i) before the ack, in both relay and direct modes.
- Relay env renamed to AIGM_*. docs/BOT-API.md (JSON schema), examples/echo-gm.mjs, tools/set-release.mjs; manifest/download placeholders.
- Fix: dead outbox items (retries exhausted with no relay ack) are purged after 6 h on load/leader change; status().deadIds and api.clearDead().

## 0.2.1 (2026-11-02)
- Prayers label confirmed from pirateborg source: class item system.extraResourceNamePlural (Actor#extraResourceNamePlural getter, base-class fallback). Adapter reads exactly that.

## 0.2.0 (2026-11-01, source only, not installed)
- relay/: real relay (core.mjs, foundry-client.mjs, index.mjs, Dockerfile, RUN.md). Env webhook URL/auth; idle if unset.
  One handler per message: lockfile, persisted done-set, idempotency-key=batchId, re-emitted batches re-acked without re-POST,
  ack only after 2xx, retries 2/5/15/60 s, 4xx dead-letter, auth never logged.
- postVoice (voice + text fallback, ack after post), serial deduped audio queue, playAudio.
- Pirate Borg adapter: hp, luck (Devil's Luck), rituals, class extraResource (e.g. Prayers) kept separate from rituals; vehicles.
  setHP now writes system.attributes.hp.value on pirateborg. New getResources, setResource (value|delta, clamped).
- whisper, tokenUpdate (hidden/elevation/rotation/alpha); post/whisper/postVoice accept ackEventIds.

## 0.1.1 (2026-11-01)
- Reply dedupe (post replyTo) persisted in the dedupe store; survives reloads and leader changes.
- post accepts allowMultiple (boolean, default false).
- Repeated commandId: 409 with alreadyDone:true + prior result when done; alreadyDone:false while in progress.
- Dedupe claims flushed immediately (no debounce); new leader reloads dedupe/outbox and re-checks the last 2 min / 50 chat messages.

## 0.1.0 (2026-11-01)
- First build: leader election, dedupe, typed commands, acked outbound queue, enabled=false default.
