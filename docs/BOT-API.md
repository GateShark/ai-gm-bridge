# AI GM Bridge: bot API

Your bot is a webhook. The bridge POSTs **event batches** to it. The bot answers with **commands**, which run inside Foundry.
There are two ways to deliver:

- **relay** (recommended): an external process (`relay/`, configured by env only) logs in as the bot GM user and POSTs batches.
- **direct**: the bot GM user's browser POSTs batches. Configure it in *Configure AI GM*. The webhook must allow CORS.

Every request has the headers `content-type: application/json`, `<auth header>: <secret>` and `idempotency-key: <batchId>`.
Answer `2xx` once you have the batch. Until the bridge sees a 2xx it retries (2 s, 5 s, 15 s, then 60 s), and every retry
carries the same `batchId` and exactly the same events. Most `4xx` answers are final; `408` and `429` are retried.

## Webhook payload (request body)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["batchId", "world", "events"],
  "properties": {
    "batchId": { "type": "string", "description": "world:hash of the exact event set; same id = same events" },
    "world":   { "type": "string" },
    "seq":     { "type": "integer" },
    "attempt": { "type": "integer", "description": "present on retries (2, 3, ...)" },
    "ctx":     { "type": "object", "description": "only keys that changed since the last acked batch",
                 "properties": { "scene": { "type": ["string", "null"] }, "paused": { "type": "boolean" },
                   "combat": { "type": ["object", "null"], "properties": { "id": {}, "round": {}, "turn": {}, "who": {} } } } },
    "hints":   { "type": "object", "properties": { "ttsMinChars": { "type": "integer" } } },
    "events":  { "type": "array", "items": { "oneOf": [
      { "type": "object", "required": ["eventId", "type"], "properties": {
          "eventId": { "type": "string", "pattern": "^chat:" }, "type": { "const": "chat" },
          "author": { "type": "string" }, "speaker": { "type": "string" }, "text": { "type": "string", "description": "plain text, trimmed" },
          "whisper": { "type": "array", "items": { "type": "string" } }, "rolls": { "type": "array" },
          "ic": { "type": "boolean" }, "alwaysVoice": { "type": "boolean" },
          "why": { "enum": ["mention", "whisper", "keyword", "question", "ic", "roll"] } } },
      { "type": "object", "required": ["eventId", "type"], "properties": {
          "eventId": { "type": "string", "pattern": "^combat:" }, "type": { "const": "turn" },
          "combat": { "type": "object" }, "combatant": { "type": ["string", "null"] }, "isNPC": { "type": ["boolean", "null"] } } },
      { "type": "object", "required": ["eventId", "type", "requestId"], "description": "v0.6: answer to requestRoll (urgent, sent once)", "properties": {
          "eventId": { "type": "string", "pattern": "^rollreq:" }, "type": { "const": "rollResult" }, "requestId": { "type": "string" },
          "actor": { "type": "string" }, "user": { "type": "string" }, "by": { "type": "string", "description": "who rolled (player or GM fallback)" },
          "stat": { "type": "string" }, "dr": { "type": "integer" }, "total": { "type": "integer" }, "natural": { "type": ["integer", "null"] },
          "success": { "type": "boolean" }, "crit": { "type": "boolean" }, "fumble": { "type": "boolean" } } },
      { "type": "object", "required": ["eventId", "type", "requestId"], "description": "v0.6: requestRoll timed out; the card now shows a GM-only fallback button (not urgent)", "properties": {
          "eventId": { "type": "string", "pattern": "^rollreq:.*:timeout$" }, "type": { "const": "rollTimeout" }, "requestId": { "type": "string" },
          "actor": { "type": "string" }, "user": { "type": "string" } } } ] } }
  }
}
```
Fields that are empty, false or null are left out.

Since v0.6, `turn` events are only sent when the `turnWake` setting is on. As of v0.8.11 it defaults on and only fires for NPC/monster turns (player-character turns stay local). Turn prompts are still posted in Foundry with no extra wake.
Batching: one wake per chat burst, flushed after `debounceMs` (1200) of quiet or at most `maxWaitMs` (default 3500, configurable) after the first event.

## Response body (optional)
```json
{ "commands": [ { "name": "post", "args": { "content": "Arr!", "replyTo": "chat:abc" }, "commandId": "optional-unique-id" } ] }
```
You can send up to 20 commands. Each one runs once: if you leave out `commandId`, the bridge uses `batchId:index`, and a repeated
id returns 409 `{alreadyDone, prior}` instead of running again. The bridge acks the events after the commands have run.

## Commands
Every command returns `{"ok":true,"result":{...}}` or `{"ok":false,"code":<http-like>,"error":"..."}`.

| name | args |
|---|---|
| getState | none |
| post | content, replyTo?, speakerAlias?, allowMultiple?, ackEventIds? |
| whisper | content, to: [user names or ids], replyTo?, ackEventIds? |
| postVoice | content, audioPath? (uploaded mp3), voice?, replyTo?, ackEventIds?; falls back to text |
| voiceLookup | content, voice?; returns {skipTts, cached}. Call it before TTS to reuse a clip or skip short replies |
| playAudio | path, id?, volume?, wait? |
| roll | formula, flavor?, toChat? |
| move | tokenId or tokenName, sceneId?, x, y; returns the final position. If a normal move doesn't arrive, it retries once as `TokenDocument.move` with action `displace` (ignoring walls and cost) and adds `via:"displace"`; 504 only if that also fails |
| setBackground | src, sceneId? or sceneName? (default: viewed/active scene). Foundry v14 stores the background on the scene's first level, so it updates `scene.levels.contents[0]`; older versions update the scene. Returns {sceneId, via: level or scene, levelId, src} |
| format | result (any command reply); returns {text}, a one-line readable version |
| tokenUpdate | tokenId or tokenName, hidden?, elevation?, rotation?, alpha? |
| setHP | actorId or actorName, or tokenId/tokenName (+sceneId); value or delta, path? |
| getResources / setResource | actorId or actorName, or tokenId/tokenName (+sceneId); resource (hp, luck, rituals, prayers, hull, crew, ...), value or delta. If you only pass an actor name/id, an unlinked token of that actor on the viewed scene is preferred (same as setHP/rest) |
| nextTurn / endCombat | expect: {combatId, round, turn} (copy `expect` from turnStatus). nextTurn: 400 if expect is missing, with the current combatant/round/turn in the error; 409 if stale, naming who is actually up |
| scene | sceneId or sceneName, activate? |
| music | playlist, sound?, action: play or stop |
| unpause | none |
| lockToken | tokenId or tokenName, sceneId?, locked, scope?: "move" (default; blocks player x/y/elevation/rotation) or "all" (blocks every player edit). GMs are never blocked |
| upload | name (e.g. map.png), data (base64 or data: URL), kind?: images/audio/text. GM-only. Saved as `ai-gm-uploads/<kind>/<hash>-<name>`; the same bytes return the same path with existed:true and no re-upload. Limits come from settings: size (default 8 MB) and types (png, jpg, jpeg, webp, gif, mp3, ogg, wav, webm, txt, md, json). The content must match its extension. Errors: 403, 413, 415 |
| spawnAndVision | actorId or actorName, sceneId?, x, y, name?, hidden?, elevation?, disposition?, vision? {enabled, range 0-1000, angle 1-360, visionMode: basic, darkvision, monochromatic, tremorsense, lightAmplification}, light? {dim, bright, color "#rrggbb", angle, alpha, animation {type, speed, intensity}}, locked?, lockScope?, spawnKey? (idempotent: returns the existing token with duplicate:true) |
| setVision | tokenId or tokenName, sceneId?, vision?, light? (same shapes as spawnAndVision) |
| requestRoll | user (name or id), actorId? or actorName? (default: the user's character), stat (strength/agility/presence/toughness/spirit, or str/agi/pre/tou/spi), dr, label?, requestId?, timeoutMs? (default setting, 120000). Posts a card with a Roll button only that player or a GM can use. Any d20 roll by that player after the card (button, sheet, or Pixels dice) answers it. Returns {requestId, messageId, status}; the same requestId returns the existing card and result with duplicate:true. You get one `rollResult` event. On timeout you get `rollTimeout` and a GM-only "roll for them" button appears. **v0.8.4 any formula:** pass `formula` (any Foundry formula, e.g. `1d6`, `2d4+1`, `1d20+@abilities.agility.value`, evaluated with the actor's roll data) with `label`; then `stat` and `dr` are optional. Same button and same `rollResult` event, plus `formula` and `label`; `success` is null when no `dr` was given (true/false vs `dr` otherwise). Non-d20 formula requests are answered only by their card button. Errors: BAD_FORMULA, BAD_STAT, BAD_ARGS (stat test without dr) |
| turnStatus | none; returns {active, round, turn, name, ownerNames, ownerIds, next, isNPC, expect} where `expect` is `{combatId, round, turn}` ready to pass to nextTurn (null when there is no combat). `isNPC` uses the same helper as turn events (combatant.isNPC / hasPlayerOwner / character type / token actor / combatant.players) |
| recap | since? (ms epoch or ISO), max? (40); returns {count, counts, summary, lines} from the GM-only "AI GM Session Log" journal. Lines are newest first; each starts with Today, Yesterday, or the date, plus the time |
| rest | actorId or actorName, or tokenId/tokenName (+sceneId); length?: short or long (default long; `kind` is accepted as an alias), food?: eat, starve or donteat (default eat), infected?. Unknown rest types are rejected (`length must be short or long`) instead of doing a long rest. Rituals and class resources are skipped when the actor has none (`max` is 0). Pirate Borg rules (see below); returns before, after, report and rolls, and posts a summary card |
| speakBubble | tokenId or tokenName, sceneId?, text (plain, max 300), emote?. Shows a chat bubble over the token on every client (one socket message, no chat message) |

### v0.6 local features (no bot wake)
- Turn prompts (`turnPrompts`, on): each turn change posts "Round N: X is up (Player). Next: Y." and notifies the owning player. Players listed in `turnVoiceUsers` also hear it on their own client: a cached voice clip if the bot ever voiced the exact text "X, you're up." (use `postVoice`, or `voiceLookup` to check), otherwise the browser's speech synthesis.
- Chat: `!turn` (who is up), `!rest <actor> [short|long] [starve|donteat] [infected]` (owner or GM).
- Session log (`sessionLog`, on): HP changes, 0 HP, items gained, Devil's Luck/rituals/extra resource changes, combat start/end and rests are written as timestamped lines to a GM-only journal "AI GM Session Log", one page per day, at most one write per 4 s.
- Pirate Borg rest, mirrored from the system's rest action (pirateborg 1.9.0): short = heal d4 if eating and not infected, grog hours -1 (when grog is on). Long = starving d4 damage, infected d6 damage, heal d8 if eating and not infected, rituals = max(d4+Spirit, 0), the class extra resource (e.g. Prayers) re-rolled from the class formula, Devil's Luck re-rolled from the luck die only if it is 0, grog effects cleared. The system's own per-day and grog functions are used when they load; otherwise the same formulas run in the module.

Usage tip: upload a file once, then refer to its returned `path` (for example in `playAudio` or `postVoice`). Pass a `spawnKey` so a retried command never places a second token.

`replyTo` stops duplicate replies: a second `post` with the same `replyTo` returns the first message.

## Example
`examples/echo-gm.mjs` is a working bot of about 50 lines: `AIGM_WEBHOOK_AUTH=change-me node examples/echo-gm.mjs`.

## Debug: timing harness (GM, browser console)
```js
await game.modules.get("ai-gm-bridge").api.debug.burstTest({ count: 9, gapMs: [1100, 2300] })
// -> { batches: [3, 4, 2], sentAtMs: [...], maxHoldMs: 3998, holdsMs: [...] }
```
This posts no chat messages and wakes no bot. It uses the world's debounce and cap settings.

## v0.6.1 notes
- `setHP {actorName, delta: -3}` or `{value: "+2"}` or `{value: 5}`.
- Roll cards match sheet rolls, Pixels rolls and button rolls. With several open cards: same actor → same ability → oldest. `rollResult.via` = button | sheet roll | roll.
- Card states: pending → timeout (GM button, rollTimeout event) → expired (no longer answerable).

## v0.7.0: GM-only context (no spoilers to players)
`{"name":"getContext","args":{"maxChars":4000,"since":"<last hash>"}}`, or `game.modules.get("ai-gm-bridge").api.context({...})` on a GM client.
- Args: `scene` (id/name, default active scene), `journals` ("Entry" or "Entry/Page", comma list or array), `maxChars` (200–20000, default 4000), `since` (hash you hold), `full` (force full text).
- Result: `{hash, unchanged:true}` or `{hash, unchanged:false, full, text, changed?, removed?, sectionHashes}`. Sections: scene, combat, tokens (visible + hidden), journals.
- The text contains secrets (hidden tokens, GM notes). It is returned only to the caller: never chat, whispers, socket or UI. Non-GM → 403. Don't paste it into player-facing replies.
- Which journals: pass `journals` on each call (entry names, "Entry/Page", or folder names, which include subfolders). With the relay, set `AIGM_CONTEXT_JOURNALS` and omit `journals`. Since v0.7.2 nothing about this list is stored in the Foundry world (Foundry sends all journals and settings to players' browsers).
- Sections: `scene`, `combat`, `tokens`, `journal:<name>`; `changed` lists sections that are new or different (their text is in `text`), `removed` lists sections that are gone (since v0.8 never also in `changed`), and `sectionHashes` has one hash per section.
- rollResult: `success`, `crit`, `fumble` are always booleans.

## v0.8.0: morale and ships (Pirate Borg)
Uses the pirateborg system's own outcome builders and chat card, without its crew-action dialog. Every command takes `toChat` (default true: post the system card; false: result only). Cards posted this way never wake the bot.
- `moraleCheck {actorId|actorName?, morale?}`: system morale rule (2d6 ≤ morale stands, else 1d6: 1-3 flees, 4-6 surrenders). Morale comes from `morale` or the creature's sheet. → `{morale, total, second, result: "stands"|"flees"|"surrenders"}`
- `shipAction {actorId|actorName, action, crewActorId|crewActorName?, dr?, armor?, targetTokenId|targetTokenName?, movement?}`; action is one of broadsides, smallArms, ram, repair, fullSail, comeAbout, dropAnchor, weighAnchor, shanty, sink (aliases ok: "broadside", "full sail", "sing"). `crew` adds that PC's ability like the sheet's PC action. `armor` defaults to the target's own armor die (ship hull tier). Ram rolls ram die + movement (scaled by size). By default it matches the pirateborg system exactly: the target's armor is rolled and shown on the card but not subtracted. The GM world setting `ramUsesArmor` (house rule, default off) subtracts the armor roll. Shanty spends one use (409 when none). → `{action, title, total, dr, success, crit, fumble, damageFormula?, damage?, sinkResult?, shantiesLeft?}`
- `shipDamage {actorId|actorName, amount | formula, armor?}`: subtracts the ship's hull armor die roll (unless `armor:false`), sets HP with the system's `updateHp`, never below 0. → `{rolled, armorDie, reduction, damage, before, after, sinking}`
- `getShip {actorId|actorName}` → hp, hull + armorDie, agility, skill, speed, crew, shanties, cargo, weapons dice, captain, crewActors, sinking.
- Local (no wake): `!morale <actor> [n]`, `!ship <ship>`, `!broadsides|!smallarms|!ram|!repair|!fullsail|!comeabout|!shanty|!sink <ship> [dr N]`. Players may use them on actors they own.

## v0.8.1 notes

### Reading replies (don't post raw JSON)
Every command reply is wrapped: `{"ok":true,"result":{...}}` or `{"ok":false,"code":404,"error":"..."}`. Read `result`, don't paste the
whole object into chat (you get raw JSON, or `[object Object]` if you string-concatenate it). Write the narration yourself from the fields,
or use the helper for a quick readable line:
```js
const r = await api.run({ name: "getShip", args: { actorName: "My Ship" } });
if (!r.ok) console.warn(r.code, r.error); else await api.run({ name: "post", args: { content: api.format(r) } });
```
`api.format(reply)` (browser) and the `format` command (`{name:"format",args:{result:reply}}`) return the same text. Prefer a
`summary`/`report` field when a command gives one.

### Voice
The module never makes audio itself (no TTS keys live in the world). The voice path is:
1. `voiceLookup {content, voice}`: if `cached` is a path, skip TTS; if `skipTts` is true, reply as text.
2. Otherwise your bot or relay runs its own TTS and sends the mp3 with `upload {name:"line.mp3", data, kind:"audio"}`.
3. `postVoice {content, audioPath: <path from upload>, replyTo}` posts the text with an audio player, plays it in order, and caches
   it for the same text next time. A missing or broken file falls back to a text reply.
Without any TTS, turn prompts for `turnVoiceUsers` use the player's browser speech synthesis. Use `playAudio` for sound effects.

### Bot-author commands: `!` shortcuts typed by the bot are ignored
`!turn`, `!rest`, `!morale`, `!ship`, `!roll`, `!hp`, `!luck`, `!prayers` and the other `!` shortcuts run locally only for messages
from humans. Messages authored by the bot GM user (`authorId === botUserId`) never run local commands and never wake the bot, so the
bot can't loop on its own output. This is by design. For the bot, call the typed command instead (`turnStatus`, `rest`, `moraleCheck`,
`getShip`, `shipAction`, `roll`, `setHP`, `setResource`). To test a shortcut, type it from a second login (a player or another GM user);
Foundry allows only one session per user.

### Ram armour field
`shipAction ram` returns `armor` only when the `ramUsesArmor` house rule is on (that roll was subtracted). With it off (the default,
matching the system), the target's armour is still rolled and shown on the card, but it is reported as `armorRoll` so it isn't read
as a reduction.

### Burst grouping
Events closer together than `debounceMs` (default 1200 ms) go out as one batch; a batch is never held longer than `maxWaitMs`
(3500 ms). Events further apart than `debounceMs` are sent separately on purpose. Check timing in the world with
`api.debug.burstTest({count: 3, gapMs: 300})` (expect `batches: [3]`); it posts nothing and wakes no bot.

## v0.8.2 notes
### Unlinked tokens (`tokenId` / `tokenName`)
`setHP`, `setResource`, `getResources`, `shipDamage`, `getShip` and `rest` accept `tokenId` or `tokenName` (optional `sceneId`, default the viewed/active scene).
If the token is unlinked (`actorLink: false`, it keeps its own stats) the write goes to `token.actor`; replies then include `tokenId` and `via: "token"`.
Linked tokens, or calls with only `actorId`/`actorName`, write the base actor as before. Pass the token for monsters/NPCs placed from a shared actor.

### "GM is thinking…" indicator
After a batch with a player message or roll result is sent to the bot, every client shows a small bottom-right notice (not a chat message).
It clears when the bot user posts a chat message, a voice line plays, or the bot runs any command; otherwise after `thinkingTimeoutMs` (default 90000, 0 = no timeout).
Turn it off with the `thinkingIndicator` world setting. Text: `AIGM.thinking` in lang files.

## v0.8.3: combat start/end events
When Foundry combat starts (`combatStart`, or `updateCombat` reaching round 1) or ends (`deleteCombat`; ending combat deletes it), the module sends one event at once, skipping the debounce:
```json
{ "eventId": "combat:<id>:start", "type": "combat", "state": "start", "combatId": "<id>", "sceneId": "<id>", "round": 1, "combatants": ["Hero", "Bilge Rat"] }
```
`state` is `"start"` or `"end"` (`round` is the last round on end). Only the leader client (bot user, else the active GM) sends it, and the eventId is deduped, so each combat gives at most one start and one end. A combat deleted before it started sends no end.
Use it to keep the bot awake during fights and let it sleep otherwise. Setting `combatEvents` (default on).
Optional per-turn events: `turnWake` (default on since v0.8.11) sends `{type:"turn", combat:{id,round,turn}, combatant, isNPC}` on NPC/monster turn changes, without debounce. Player-character turns never send this event.


## Push-to-talk (v0.8.5)
No new command or event. Push-to-talk (v0.8.5, per player, off by default): each player enables **Push-to-talk (this browser)** (`pushToTalk`, client setting) and holds the key (`pushToTalkKey`, default `Backquote`, the ` key) or the 🎤 button bottom-left. The browser's Web Speech API transcribes (language from Foundry's language setting) with a "Listening…" indicator showing live text; on release the transcript is posted as that player's normal chat message. The key is ignored while typing in a text field. Chrome/Edge only (no Firefox: one-time notice, no button); needs mic permission, which browsers allow only on HTTPS or localhost. Speech goes to the browser's own speech service (Chrome/Edge send audio to Google/Microsoft), nothing to this module's servers. For the bot it arrives exactly like typed chat (normal `chat` event from that user).


## v0.8.8 notes (UI polish; additive events)
These events are new. Older bots that only handle `chat` / `rollResult` / `combat` / `turn` can ignore them.

### Control events (from the GM panel)
When the world GM pauses, resumes, redos or skips, the leader sends an urgent event:
```json
{ "eventId": "control:redo:1731180000000", "type": "control", "action": "redo", "targetEventIds": ["chat:abc"], "replyTo": "chat:abc" }
```
`action` is one of `pause`, `resume`, `redo`, `skip`. `targetEventIds` (redo/skip) are the last player chat/roll events that were sent to you. Treat `redo` as "please answer those again" and `skip` as "do not answer them". `pause` means stop answering until `resume`. The module also stops sending normal chat events while the world setting `aiPaused` is true.

### Cancelled rolls
`{"name":"cancelRoll","args":{"requestId":"..."}}` marks a pending roll card cancelled (no longer answerable) and emits:
```json
{ "eventId": "rollreq:<id>:cancel", "type": "rollCancelled", "requestId": "<id>", "actor": "Name", "user": "Player" }
```

### Test connection
The settings **Test connection** button POSTs `{ "type": "testConnection", "ping": true }` to the webhook URL (same auth header, no `events` array and no `batchId`). Answer `2xx` if you can; any HTTP response is treated as "reached the server". In relay mode with no URL stored in Foundry, the button checks that the bot user is connected instead.

### Status light
There is no extra bot API for the status light. It is derived from the existing leader heartbeat, the thinking socket, whether the bot user is connected, and `aiPaused`.

## v0.8.9: relay-mode chat ack
In **relay** delivery, `chat` events are marked received after the batch is emitted on the module socket and the `ai-gm-bridge.events` hook. The module does not retry those chat events. That matches relays that read Foundry chat themselves (for example a `/wait` loop) and would otherwise leave chat sitting in the outbox until it dies.

Other event types (`control`, `combat`, `rollResult`, `rollCancelled`, …) still wait for an explicit `api.ack(eventIds)`. The official `relay/` still acks after a webhook 2xx. Calling `api.ack` again on already-acked chat ids is a no-op.

**Direct** delivery is unchanged: the module acks after a webhook 2xx.

Chat that was already flushed at least once (including dead items) is also acked when the leader starts up in relay mode, so old unacked chat does not re-send after a reload.

Redo/skip `targetEventIds` still prefer the last player chat/roll batch that was sent to you. If that list is empty (for example after a reload), the module falls back to the newest player chat event ids instead of sending `[]`.

## v0.8.10: scene HP, rest safety, broader relay ack
`getContext` / game summary reads live Pirate Borg HP at `system.attributes.hp` (not a leftover `system.hp` of 0). Player-owned or `character` tokens are labeled as PCs even if the token disposition is hostile.

`getResources`, `setResource`, `setHP`, and `rest` prefer the viewed scene token's actor when only `actorId`/`actorName` is given, so unlinked token stats are used.

In **relay** delivery, `chat`, `combat`, `turn`, `rollResult`, `rollTimeout`, and `rollCancelled` are marked received after emit. `control` still waits for `api.ack`. The official `relay/` still acks after a webhook 2xx; a second ack is a no-op.

The GM panel **Clear stuck** button (and `api.clearStuck()`) acks every remaining outbox item (queued and dead). Non-leader GMs forward the request so the leader persists the empty queue.

## v0.8.11: NPC turn wakes, ready expect, combat-end roll cancel
`turnStatus` includes `expect: {combatId, round, turn}`. Pass that object back as `nextTurn`/`endCombat` `expect`. If it is missing or stale, the error names the current round, turn, and combatant.

`requestRoll` stamps the current `combatId` when a combat is active. When that combat is deleted/ended the module emits the existing `{type:"combat", state:"end"}` event and auto-cancels pending roll cards for that combat (`rollCancelled`), so leftover defence reminders cannot time out after the fight.

## v0.8.12: turnStatus PC ownership
`turnStatus` / `turnInfo` use the same `combatantIsNpc` helper as `turn` events, so an unlinked player-owned token is not labeled `isNPC: true` with empty owners. `combatant.players` is included in `ownerIds`/`ownerNames` even when the synthetic token actor does not report OWNER via `testUserPermission`.
