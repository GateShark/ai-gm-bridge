# AI GM Pirate Borg: bot API

Previously called AI GM Bridge. The module id remains `ai-gm-bridge` (`game.modules.get("ai-gm-bridge")`).

Your bot is a webhook. The bridge POSTs **event batches** to it. The bot answers with **commands**, which run inside Foundry.
There are two ways to deliver:

- **relay** (recommended): an external process (`relay/`, configured by env only) logs in as the bot GM user and POSTs batches.
- **direct**: the bot GM user's browser POSTs batches. Configure it in *Configure AI GM Pirate Borg*. The webhook must allow CORS.

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
| postVoice | content, audioPath? (uploaded mp3), audio? (map keyed by voice slug), voice?, replyTo?, ackEventIds?; each client plays their chosen voice and falls back to Ryan, then to text |
| listVoices | none; returns {voices, default, selected}. Each voice includes id, name, label, locale, gender, slug, and preview (bundled `assets/voice-preview/voice-<slug>.mp3`). `selected` is this client's pick (empty → Ryan). Edit only `TTS_VOICES` in scripts/lib/voices.mjs to swap the list |
| voicePrefs | none; returns [{userId, name, active, voice}] for every user. `voice` is that user's `flags['ai-gm-bridge'].gmVoice` slug, or `ryan` if unset |
| registerTurnClips | clips: [{audioPath, file?, name?, voice?}] (or a single clip via top-level fields). Registers uploaded Your-turn mp3s named `turn-<pc\|generic>-<ryan\|thomas\|sonia\|aria>.mp3`. A missing voice suffix means Ryan. Returns {registered, errors, clips} |
| listTurnClips | none; returns the registered Your-turn clips |
| voiceLookup | content, voice?; returns {skipTts, cached, voice}. Call it before TTS to reuse a clip or skip short replies. `voice` is resolved against the table list (empty → Ryan) |
| playAudio | path? and/or audio? (map keyed by voice slug), id?, volume?, wait?. Each client plays their chosen voice and falls back to Ryan |
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
| setMood | mood: combat\|storm\|tavern\|explore\|tense\|calm\|none, fadeMs? (default 1500). GM-side only. Plays the mapped Foundry playlist and crossfades the previous one. Mapping is the world setting `moodPlaylists` (`combat=Playlist Name` lines). Unmapped moods match a playlist by name. If a mapped playlist is missing: 404, nothing plays. `none` fades out the current playlist. No music files are bundled |
| unpause | none |
| lockToken | tokenId or tokenName, sceneId?, locked, scope?: "move" (default; blocks player x/y/elevation/rotation) or "all" (blocks every player edit). GMs are never blocked |
| upload | name (e.g. map.png), data (base64 or data: URL), kind?: images/audio/text. GM-only. Saved as `ai-gm-uploads/<kind>/<hash>-<name>`; the same bytes return the same path with existed:true and no re-upload. Limits come from settings: size (default 8 MB) and types (png, jpg, jpeg, webp, gif, mp3, ogg, wav, webm, txt, md, json). The content must match its extension. Errors: 403, 413, 415 |
| spawnAndVision | actorId or actorName, sceneId?, x, y, name?, hidden?, elevation?, disposition?, vision? {enabled, range 0-1000, angle 1-360, visionMode: basic, darkvision, monochromatic, tremorsense, lightAmplification}, light? {dim, bright, color "#rrggbb", angle, alpha, animation {type, speed, intensity}}, locked?, lockScope?, spawnKey? (idempotent: returns the existing token with duplicate:true) |
| setVision | tokenId or tokenName, sceneId?, vision?, light? (same shapes as spawnAndVision) |
| requestRoll | user (name or id), actorId? or actorName? (default: the user's character), stat (strength/agility/presence/toughness/spirit, or str/agi/pre/tou/spi), dr, label?, requestId?, timeoutMs? (default setting, 120000), formula?, replyTo?. Posts a card with a Roll button only that player or a GM can use. Any d20 roll by that player after the card (button, sheet, or Pixels dice) answers it. Returns {requestId, messageId, status}; the same requestId, the same `replyTo`, or another open card for the same user+actor+formula/stat+label returns the existing card with duplicate:true. You get one `rollResult` event (already urgent). On timeout you get `rollTimeout`; the player Roll button stays and a GM "roll for them" button is added. **Any formula (0.8.4+, 0.8.17 d4):** pass `formula` (`1d6`, `d4` or `1d4`, `2d4+1`, `1d20+@abilities.agility.value`) with `label` (e.g. Broken); `stat` and `dr` are then optional. `d4` is stored as `1d4`. Unflagged sheet rolls with the same die faces can answer a matching formula card. An unflagged d20 still never answers a non-d20 formula card. Errors: BAD_FORMULA, BAD_STAT, BAD_ARGS (stat test without dr) |
| turnStatus | none; returns {active, round, turn, name, ownerNames, ownerIds, next, isNPC, expect, serverTime, gmUserActive, lastSeen, worldId, bot:{id,name,active}?, botActive?} where `expect` is `{combatId, round, turn}` ready to pass to nextTurn (null when there is no combat). `isNPC` uses the same helper as turn events (combatant.isNPC / hasPlayerOwner / character type / token actor / combatant.players). Presence fields are read-only (no extra write). `bot` is plain `{id, name, active}` only. When the current combatant is a pet, also `isPet`, `simpleAction`, and `petOwner`; ships also set `isShip` |
| setGmStatus | state (listening/idle/ready, asleep, waking, reading, thinking, rolling, voicing, speaking), note? (plain text, shown in the pill tooltip only, max 80 chars), timeoutMs?. Cheap player-visible status. The module already sets waking (event sent), reading (relay claimed/acked), rolling (`requestRoll`), voicing (`postVoice`/`voiceLookup`), speaking (audio playing), and offline. Call this when you start thinking or generating TTS (`thinking`, `voicing`) or when your session goes idle (`asleep`). It broadcasts one socket message and auto-clears to ready/listening so it never sticks. |
| ping | none; writes a tiny nonce to a world setting and reads it back. Returns {ok, serverTime, gmUserActive, lastSeen, worldId, bot:{id,name,active}, botActive} only when the nonce matches; otherwise a 504 after about 5 seconds if Foundry does not confirm. Use this to verify the Foundry link before a write. `bot` is plain fields only (never a Foundry User document) |
| debugSuspendPresence | seconds (0 cancels, cap 600). GM-only debug hook via `api.debugSuspendPresence(s)` (any GM) or this command. Stops the bot's periodic nonce refresh until then so the offline light can be tested; auto-resumes. Not a Basic setting. Default off, no effect on normal play |
| setupCheck | none; returns {ok, scene, checked, unowned, warning, text}. Lists scene/combat actors that look like player pirates (character type or a class item) but have no non-GM owner. Warning only — nothing is changed |
| recap | since? (ms epoch or ISO), max? (40); returns {count, counts, summary, lines} from the GM-only "AI GM Session Log" journal. Lines are newest first; each starts with Today, Yesterday, or the date, plus the time |
| saveSession | notes? (optional GM plot threads, stored but never put in the recap). Overwrites one hidden world setting with a compact snapshot: scene, combat if started, up to 24 tokens (id, name, tokenId, hp, pc, a few key item names, pet flag), and notes (capped). Returns the snapshot plus a spoiler-free `recap` string |
| loadSession | placePets? (default true), applyHp? (default false), toChat?. Returns {recap, snapshot, placed, hpApplied}. Recap omits notes. `toChat` posts only the recap |
| setPet | actor/token; ownerActorId or ownerActorName and/or ownerUserId or ownerUserName; simpleAction? (default true). Writes flags["ai-gm-bridge"].pet on the companion |
| listPets | none; lists actors that have a pet flag |
| placePets | sceneId?. Moves or creates each pet token beside its owner's token |
| start | none; unpauses Foundry, clears aiPaused, emits control `start` (wake). Same as panel Start game / api.startGame() |
| pause | none; sets aiPaused, pauses Foundry, emits control `pause`. Queued non-control events are held (not dropped) until Start or Clear stuck. Same as panel Pause game / api.pauseGame() |
| rollTable | tableId or tableName, displayChat? (default true). Draws a world RollTable |
| giveLoot | tableId or tableName or table, plus actor/token or a selected token. Draws the table and adds Item results (and silver text such as "12 silver") to that actor |
| rollLoot | table? (name or id; default: a world or compendium table named Treasure, Loot, Plunder, or Cargo), count? (1–20, default 1), targets (same shapes as giveLoot), toChat?. Draws the table, puts items or silver (`system.silver`) on each target sheet, and posts a summary card. Reuses the giveLoot award helper |
| applyDamage | amount (absolute), tokenIds? or actorIds? (default: selected tokens). Subtracts HP and clamps at 0 |
| startShipCombat | tokenIds? (default: selected ship tokens, else every ship on the scene). Adds them to combat, starts it if needed, emits `shipCombat` |
| shipStatus | none; ships on the viewed scene plus the in-memory crew-action counts for the current combat round |
| rest | actorId or actorName, or tokenId/tokenName (+sceneId); length?: short or long (default long; `kind` is accepted as an alias), food?: eat, starve or donteat (default eat), infected?. Unknown rest types are rejected (`length must be short or long`) instead of doing a long rest. Rituals and class resources are skipped when the actor has none (`max` is 0). Pirate Borg rules (see below); returns before, after, report and rolls, and posts a summary card |
| speakBubble | tokenId or tokenName, sceneId?, text (plain, max 300), emote?. Shows a chat bubble over the token on every client (one socket message, no chat message) |

### v0.6 local features (no bot wake)
- Turn prompts (`turnPrompts`, on): each turn change posts "Round N: X is up (Player). Next: Y." and notifies the owning player. By default (`voiceTurnPrompt`, on) every owner hears a recorded "Your turn" clip on their own client using their chosen voice (see Voice below). There is no browser speech: if no clip exists after the fallback chain, they get the text notification only. A non-empty `turnVoiceUsers` list still acts as an allowlist.
- Chat: `!turn` (who is up), `!setup` (unowned player-looking pirates on this scene; warning only), `!rest <actor> [short|long] [starve|donteat] [infected]` (owner or GM), `!save [notes]` / `!load` (session snapshot; GM), `!start` / `!pause` (one-step Foundry + AI GM; `!pause` is GM-only, bare `start` in chat still follows the Unpause-on-start setting).
- Session log (`sessionLog`, on): HP changes, 0 HP, items gained, Devil's Luck/rituals/extra resource changes, combat start/end and rests are written as timestamped lines to a GM-only journal "AI GM Session Log", one page per day, at most one write per 4 s.
- Pirate Borg rest, mirrored from the system's rest action (pirateborg 1.9.0): short = heal d4 if eating and not infected, grog hours -1 (when grog is on). Long = starving d4 damage, infected d6 damage, heal d8 if eating and not infected, rituals = max(d4+Spirit, 0), the class extra resource (e.g. Prayers) re-rolled from the class formula, Devil's Luck re-rolled from the luck die only if it is 0, grog effects cleared. The system's own per-day and grog functions are used when they load; otherwise the same formulas run in the module.

Usage tip: upload a file once, then refer to its returned `path` (for example in `playAudio` or `postVoice`). Pass a `spawnKey` so a retried command never places a second token.

`replyTo` stops duplicate replies: a second `post` / `postVoice` / `whisper` with the same `replyTo` returns the first message. If you omit `replyTo`, the module uses the most recent player wake id (about 3 minutes). `requestRoll` uses a separate `roll:` lock so you can still request a roll and later post damage for the same event. Always pass `replyTo` when you have it, and do not run a second handler for the same event.

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
- `moraleCheck {actorId|actorName?, tokenIds?|actorIds?, all?, morale?, reason?, markStatus?, toChat?}`: Pirate Borg morale. The official creature field is `system.attributes.morale` (see the pirateborg `template.json` creature). Rule (same as the system's `createMoraleOutcome`): 2d6 ≤ morale stands; else 1d6, 1-3 flees, 4-6 surrenders. Morale of `-` or none means the creature never breaks (`unbreakable: true`, result `stands`, no roll). `all: true` (or no specific target while combat is active) checks every living hostile in combat. Each creature gets a chat card (`toChat` default true; cards are marked so they never wake the bot). `markStatus` (default true) can set `fear` on flee and `restrained` on surrender. → `{results:[{actorId, name, morale, total, second, result, unbreakable, status}], reason, checked}` (a single target also copies those fields onto the top-level result).
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
The module never makes audio itself (no TTS keys live in the world). Players pick the recorded voice they hear; the module never uses browser speech synthesis.

**Voice list.** `listVoices` returns Ryan `en-GB-RyanNeural` (**default**), Thomas `en-GB-ThomasNeural`, Sonia `en-GB-SoniaNeural`, and Aria `en-US-AriaNeural`. Each entry has a `slug` (`ryan`, `thomas`, `sonia`, `aria`) and a `preview` path (`modules/ai-gm-bridge/assets/voice-preview/voice-ryan.mp3`, and the same pattern for the others). Those bundled previews are what the Spoken voice dropdown plays — not the Your-turn clips. `selected` is this client's pick. Pass the `id` or short name as `voice` on `voiceLookup`. An empty `voice` becomes Ryan. Unknown ids are left as-is.

**Each player's pick.** `ttsVoice` is a per-player client setting (not world, not GM-only). On change and on ready, the module writes `flags['ai-gm-bridge'].gmVoice` to the slug (`ryan` / `thomas` / `sonia` / `aria`). Call `voicePrefs` to read `[{userId, name, active, voice}]` for every user; a missing flag is `ryan`.

**Voice message format.** Prefer an `audio` map keyed by voice slug so each client hears their pick and falls back to Ryan:

```json
{ "name": "postVoice", "args": {
  "content": "The skeleton swings.",
  "audio": {
    "ryan": "ai-gm-uploads/audio/<hash>-line-ryan.mp3",
    "thomas": "ai-gm-uploads/audio/<hash>-line-thomas.mp3",
    "sonia": "ai-gm-uploads/audio/<hash>-line-sonia.mp3",
    "aria": "ai-gm-uploads/audio/<hash>-line-aria.mp3"
  },
  "replyTo": "chat:abc"
} }
```

`playAudio` accepts the same `audio` map (and still accepts a single `path` for one shared sound). A legacy single `audioPath` / `path` plays for everyone. If the chosen slug is missing from the map, the client plays `ryan`. Generate each clip with Azure Neural using the matching id, `upload` it, then put the returned path in the map.

**Your-turn clips.** File name: `turn-<pc-or-generic>-<ryan|thomas|sonia|aria>.mp3` (examples: `turn-tempus-thomas.mp3`, `turn-flood-sonia.mp3`, `turn-bart-aria.mp3`, `turn-seachest-ryan.mp3`, `turn-generic-thomas.mp3`). A name-only file such as `turn-tempus.mp3` is Ryan. "Sea Chest" matches `seachest`. Fallback for each listener: that PC in their chosen voice, then `turn-generic` in their chosen voice, then that PC in Ryan, then generic Ryan, then the text notification only.

Register after upload (the upload path is content-hashed but still ends with the original name):

```json
{ "name": "upload", "args": { "name": "turn-tempus-thomas.mp3", "data": "<base64 mp3>", "kind": "audio" } }
{ "name": "registerTurnClips", "args": { "clips": [ { "audioPath": "<path from upload>" } ] } }
```

You can also pass `file`, `name`, and/or `voice` if the path is not parseable. `listTurnClips` returns what is registered. Use `voicePrefs` when you generate spoken replies so you know which voices people asked for.

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
{ "eventId": "combat:<id>:start", "type": "combat", "state": "start", "combatId": "<id>", "sceneId": "<id>", "round": 1, "combatants": ["Hero", "Bilge Rat"], "roster": [{ "name": "Hero", "hp": 8, "max": 10, "isNPC": false, "owner": "Pat" }], "ownerWarning": "optional — pirate with no player owner" }
```
`state` is `"start"` or `"end"` (`round` is the last round on end). Only the leader client (bot user, else the active GM) sends it, and the eventId is deduped, so each combat gives at most one start and one end. A combat deleted before it started sends no end.
On end the same event is the combatEnded payload: it keeps `type: "combat"` (so existing bots keep working) and adds `combatEnded: true`, `defeated` (hostile combatants with HP at 0 or below), and `pcs` (player-owned combatants). Use those lists to call `giveLoot` / `rollLoot`. No second wake is sent.
Use it to keep the bot awake during fights and let it sleep otherwise. Setting `combatEvents` (default on).
Optional per-turn events: `turnWake` (default on since v0.8.11) sends `{type:"turn", combat:{id,round,turn}, combatant, isNPC}` on NPC/monster turn changes, without debounce. Player-character turns never send this event.


## Push-to-talk (v0.8.5)
No new command or event. Push-to-talk (v0.8.5, per player, off by default): each player enables **Push-to-talk (this browser)** (`pushToTalk`, client setting) and holds the key (`pushToTalkKey`, default `Backquote`, the ` key) or the logo button (draggable, position saved per browser). The browser's Web Speech API transcribes (language from Foundry's language setting) with a "Listening…" indicator showing live text; on release the transcript is posted as that player's normal chat message. The key is ignored while typing in a text field. Chrome/Edge only (no Firefox: one-time notice, no button); needs mic permission, which browsers allow only on HTTPS or localhost. Speech goes to the browser's own speech service (Chrome/Edge send audio to Google/Microsoft), nothing to this module's servers. For the bot it arrives exactly like typed chat (normal `chat` event from that user).


## v0.8.8 notes (UI polish; additive events)
These events are new. Older bots that only handle `chat` / `rollResult` / `combat` / `turn` can ignore them.

### Control events (from the GM panel)
When the world GM pauses, resumes, redos or skips, the leader sends an urgent event:
```json
{ "eventId": "control:redo:1731180000000", "type": "control", "action": "redo", "targetEventIds": ["chat:abc"], "replyTo": "chat:abc" }
```
`action` is one of `pause`, `resume`, `redo`, `skip`. `targetEventIds` (redo/skip) are the last player chat/roll events that were sent to you. Treat `redo` as "please answer those again" and `skip` as "do not answer them". `pause` means stop answering until `resume`. The module also stops sending normal chat events while the world setting `aiPaused` is true.

### Cancelled rolls
`{"name":"cancelRoll","args":{"requestId":"..."}}` (or `messageId`, or actor/label/user) marks matching open roll cards cancelled, including duplicate sibling cards for the same player/actor/label, and emits:
```json
{ "eventId": "rollreq:<id>:cancel", "type": "rollCancelled", "requestId": "<id>", "actor": "Name", "user": "Player" }
```

### Test connection
The settings **Test connection** button POSTs `{ "type": "testConnection", "ping": true }` to the webhook URL (same auth header, no `events` array and no `batchId`). Answer `2xx` if you can; any HTTP response is treated as "reached the server". In relay mode with no URL stored in Foundry, the button checks that the bot user is connected instead.

### Status light
The player-visible status pill (0.8.17) is derived automatically when it can be: event sent → **GM waking up**; relay claim/ack → **GM reading**; `requestRoll` → **GM requesting a roll**; `postVoice`/`voiceLookup` → **GM is sending a voice message…**; audio playing → **GM speaking**; no server-confirmed link → **AI GM offline**; otherwise **GM listening** (ready) or **GM paused**. Call `setGmStatus` for **GM thinking…**, **GM is sending a voice message…** (while you generate TTS, before `postVoice`), or **GM asleep**. A timeout (the thinking-indicator setting, default 90s) returns the pill to ready so it never sticks. One socket message per change; no extra polling.

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

## v0.8.13: setup check, fight roster, pcDown
`setupCheck` (command, `api.setupCheck()`, panel **Check setup**, Test connection, or local `!setup`) reports character-type or classed pirates on the viewed scene (and in the current combat) who have no non-GM owner. It never changes ownership or world data.

Combat-start events keep the `combatants` name list and add a compact `roster` of `{name, hp, max, isNPC, owner?}` using the same PC/NPC helper as turn events. If any pirate-looking combatant has no player owner, `ownerWarning` (and `unownedPirates`) is included so the bot does not play them as a monster. End events omit the roster to stay small.

`pcDown` is emitted once when a player-owned character's HP (`system.attributes.hp`) drops from above 0 to 0 or below: `{type:"pcDown", actor, actorId, tokenId, hp:{value,max}, combatId?, round?, turn?}`. It re-arms when HP goes back above 0. Unowned characters and monsters are ignored. In relay mode `pcDown` is marked received after emit (same as combat/turn/roll outcomes).

## v0.8.14: ping / last-seen / fail-fast
`ping` is a server round-trip: it overwrites one hidden world setting with `{nonce, at}` and only returns `ok` when a read-back matches that nonce (about 5 seconds, then a clear timeout). It does not call the AI webhook.

`turnStatus` (and `api.turnStatus()` / `api.status()`) include `serverTime`, `gmUserActive` (the configured bot user from Foundry's user list), `lastSeen` (last time the bot successfully confirmed a nonce), and `worldId` without doing another write.

If the calling user is not logged in or the socket is already down, `api.run` fails immediately (503) instead of hanging. Other commands time out after about 20 seconds (120s for `move`, 180s for `playAudio` with `wait`) with the same reconnect wording.

## v0.8.15: session recap, pets, start/pause, quick GM, ships
`saveSession` / `loadSession` store one overwritten hidden setting (`sessionSnapshot`). The recap string is spoiler-free (scene, HP, who was up) and never includes `notes`. World settings still sync to every client — treat notes like other world data, not a secret store. `loadSession` places pet tokens beside their owner by default and does not rewrite HP unless `applyHp` is true.

`setPet` records `{ownerId, ownerName, ownerActorId, simpleAction}` on the companion (`simpleAction` defaults to true). `turn` events and `turnStatus` add `isPet` / `simpleAction` / `petOwner` (and `isShip` for vessels). The module does not skip or shorten the Foundry turn — it only reports the house rule.

`start` unpauses Foundry and emits `{type:"control", action:"start"}`. `pause` pauses Foundry and emits `{type:"control", action:"pause"}`. While `aiPaused` is true, only `control` events are flushed; other queued events are held (use Clear stuck if you do not want them after Start). Chat `start` (when the Unpause-on-start setting is on) and GM chat `pause` do the same without a `!` prefix.

`rollTable`, `giveLoot`, `applyDamage`, and `startShipCombat` match the in-game Quick GM buttons. `startShipCombat` emits `{type:"shipCombat", state:"start", combatId, ships:[{name, actorId, tokenId, hp, crew, hull}]}`. Combat-start `roster` rows for official Pirate Borg ships (`vehicle` / `vehicle_npc`) also include `kind:"ship"`, `crew`, `crewMax`, and `hull` read from the system's own attributes. `shipAction` / `getShip` / `shipStatus` expose `crewActionsThisRound` from an in-memory counter that resets each combat round. The module never writes new `system.*` keys.

In relay mode `shipCombat` is marked received after emit (same as combat/turn/`pcDown`). `control` still waits for `api.ack`.

`api.status()`, `api.turnStatus()`, and `ping` include a plain `bot: {id, name, active}` (and `botActive`). They never embed the raw Foundry User document.

`debugSuspendPresence` / `api.debugSuspendPresence(seconds)` is a GM-only debug hook (hidden setting `presenceSuspendUntil`, cap 600 seconds, `0` cancels). It pauses the bot's periodic nonce refresh so the **AI GM offline** light can be tested after the usual offline wait, then auto-resumes. While it is running, other clients also stop treating "bot user still listed as connected" as enough to stay green. It is off by default and is not shown on the Basic settings page.

## v0.8.16: recap PCs/pets, Clear stuck controls, prompt presence resume, unified targets
Session recap (`saveSession` / `loadSession` / panel) lists only player characters and pets. Monster HP is omitted from the recap text. The stored snapshot may still include other tokens (PCs and pets are kept first if the 24-token cap is hit). The combat line may still name whoever was up.

**Clear stuck** / `api.clearStuck()` acks every remaining outbox item, including held `control` start/pause events. Non-leader GMs forward to the leader and also clear their local queue so the panel count updates immediately.

`debugSuspendPresence(0)` (and timer expiry) trigger an immediate nonce refresh and panel/status recheck (`nextProbeAt` is cleared). No extra steady-state polling is added.

`giveLoot` and `applyDamage` accept the same target arguments: `tokenId`, `tokenName`, `tokenIds`, `actorId`, `actorName`, `actorIds`, `sceneId`, plus selected-token fallback. Older call shapes keep working. `giveLoot` with multiple ids uses the first resolved target and resolves the recipient before drawing the table. `applyDamage` applies to every resolved target.

## v0.8.17: faster roll wakes, one reply per event, player-visible GM status
Module-side latency: ability-test rolls (d20 / `@abilities.*`, including Pirate Borg sheet outcomes) wake immediately (`urgent: true`) even when "Ignore plain rolls" is on. Damage dice stay filtered. `rollResult` was already urgent and is auto-acked in relay mode, so the ~57s delay seen in play is not the module debounce (1.2s), max wait (3.5s), or first outbox retry (2s). **GM side:** treat `rollResult` as an immediate wake (do not wait for a 20s unanswered/AWAKE fallback), and do not start a second handler for the same event.

Single-responder: pass `replyTo` on `post` / `postVoice` / `whisper` / `requestRoll`. If you omit it, the module locks to the latest wake id for about three minutes. Two open `requestRoll` cards for the same user+actor+formula/stat+label are collapsed to one. `cancelRoll` finds a card by `requestId`, `messageId`, or actor/label/user, and also cancels matching sibling cards.

Player-visible status (all clients, small pill, optional elapsed seconds): see `setGmStatus` above. Call `{ "name": "setGmStatus", "args": { "state": "thinking" } }` when you start writing a reply, and `{ "state": "voicing" }` when you start TTS. The module handles waking/reading/rolling/speaking/offline itself.

`requestRoll { formula: "d4" or "1d4", label: "Broken" }` posts a button for non-d20 dice. After `rollTimeout` the original player button remains.

Turn prompts say "Your turn" out loud by default (`voiceTurnPrompt`). Push-to-talk uses the module logo, is draggable, and applies a small configurable speech correction list (`speechHints` / `speechFixes`, e.g. "drop cake" → "dropkick", "Kik" → "kick").

## v0.8.18: per-player recorded voices
Each player picks Ryan, Thomas, Sonia, or Aria (`ttsVoice`, client setting). The dropdown Play sample (and a selection change) plays `assets/voice-preview/voice-<slug>.mp3` only on that computer. The pick is mirrored to `flags['ai-gm-bridge'].gmVoice`. `voicePrefs` returns everyone's slug (`ryan` if unset).

`postVoice` / `playAudio` accept `audio: { ryan, thomas, sonia, aria }`. Each client plays their slug and falls back to Ryan. Register Your-turn files with `registerTurnClips` as `turn-<name>-<voice>.mp3` (example: upload `turn-tempus-thomas.mp3`, then `registerTurnClips { clips: [{ audioPath }] }`). Fallback: PC+chosen, generic+chosen, PC+Ryan, generic+Ryan, text only. No browser speech synthesis. "pulled up behind" is corrected to "ducked behind".

## v0.8.19: replay, volume, captions, mood, morale, loot
Voiced chat lines already show a ▶ replay button (since 0.8.8). It now plays that listener's chosen recorded voice (`flags['ai-gm-bridge'].audio` map, same fallback as live playback) on their computer only (`AudioHelper.play(..., false)` via the local audio queue, id `replay:<src>:<now>`). Replay does not post chat and does not wake the bot.

`voiceVolume` is a per-player client setting (Basic page, 0–100, default 80). It applies to GM voice, dropdown previews, and Your-turn clips, and is independent of Foundry's playlist/music/ambience volume. `voiceCaptions` (client, default off) shows a large caption of the current spoken line near the bottom of the screen while the clip plays and clears it when the clip ends.

```json
{ "name": "setMood", "args": { "mood": "storm", "fadeMs": 1500 } }
```

`moodPlaylists` example:
```
combat=Battle
storm=Storm at Sea
tavern=The Salty Den
explore=Open Water
tense=Something's Wrong
calm=Safe Harbor
```

`moralePrompt` (urgent, auto-acked in relay like `pcDown`) when the first enemy dies or half the enemies are down:
```json
{ "eventId": "moraleprompt:<combatId>:firstEnemyDown", "type": "moralePrompt", "reason": "firstEnemyDown", "reasons": ["firstEnemyDown"], "combatId": "…", "round": 2, "down": 1, "total": 4, "enemies": [{ "name": "Skeleton", "actorId": "…", "hp": 0 }] }
```
This is a wake only — call `moraleCheck` yourself if you want rolls. Setting `moralePrompts` (default on).

```json
{ "name": "moraleCheck", "args": { "all": true, "reason": "firstEnemyDown" } }
{ "name": "rollLoot", "args": { "table": "Treasure", "count": 1, "actorName": "Tempus" } }
```

`rollLoot` looks up a RollTable by name or id in the world, then in compendium packs (including the official `pirateborg.rolls-gamemaster` and `pirateborg.rolls-ships` packs). If you omit `table`, it picks a table named Treasure, Loot, Plunder, or Cargo. The official system pack ships GM tables such as Mystical Mishaps, Reaction, and Broken; a dedicated treasure table may live in the world or another module. Drawn item documents go on the sheet; text matching `N silver` / `NdX silver` is added to `system.silver`.
