# AI GM Pirate Borg: setup guide

**Add-on:** AI GM Pirate Borg (module id `ai-gm-bridge`), beta **0.9.4**
**Repository:** https://github.com/GateShark/ai-gm-bridge
**Created by:** Gate (GateShark). MIT licensed.

This guide is for the person who owns the Foundry world. It takes you from installing the add-on to a working AI game master that talks to your players.

> **What the add-on does.** It sends your bot the chat and table events through a webhook, and your bot sends typed commands back (speak, roll, move tokens, run combat). The add-on is a bridge. **It does not include a bot, and it does not make voices.** Your bot makes its own voice clips and posts them (see [Voice](#9-voice)).

> **Beta note.** The add-on is built around **Pirate Borg**. Other game systems have had only basic testing, and some commands are Pirate Borg only for now (see [Pirate Borg only commands](#troubleshooting)). **Support for more game systems is planned for the 1.0 release.**

---

## 1. What you need

- **Foundry VTT v14** (verified on v14 build 369). The add-on's manifest lists v13 as the minimum.
- **A bot** that can:
  1. **Receive a webhook.** It gets an HTTP POST with a batch of events and answers `2xx` right away.
  2. **Run commands in Foundry**, either by returning them in the webhook response or from a browser session logged in as the bot's own Foundry user. Either the bot opens that browser itself, or the add-on's **relay** program logs in for it.
- **A Foundry user just for the bot** (step 3).
- About 15 minutes for the first setup.

---

## 2. Install the add-on

1. In Foundry's setup screen, open **Add-on Modules** and click **Install Module**.
2. Paste this into **Manifest URL**:

   ```
   https://github.com/GateShark/ai-gm-bridge/releases/latest/download/module.json
   ```
3. Click **Install**.

The `latest` link always points at the newest published release. The installed version is shown in the module list, and the releases page lists every version.

---

## 3. Make a Game Master user for the bot

Your bot needs its own login. Do not use your own account.

1. In your world, open the **Settings** tab of the sidebar and click **User Management**.
2. Click **Create Additional User** and give the user a name you will recognise, for example `AI GM`.
3. Set its role to **Game Master**. The add-on's bot picker only lists Game Master users (not Assistant, Trusted or Player).
4. Give it a password and keep it somewhere safe. Your bot (or the relay) needs it to log in.
5. Click **Save and Return**.

---

## 4. Turn the add-on on in your world

1. Start your world and log in as your own Game Master user.
2. In the **Settings** tab, click **Manage Modules**.
3. Tick **AI GM Pirate Borg** and click **Save Module Settings**. Foundry reloads.

The add-on is **off by default in every world**. Enabling the module in Foundry is not enough: you also switch it on in its own settings (next step).

---

## 5. The add-on settings

Open the **Settings** tab, click **Configure Settings**, pick **AI GM Pirate Borg** in the list on the left, and click **Configure AI GM Pirate Borg**.

The window has a **Basic** page and a collapsed **Advanced** section. **Click Save when you are done.**

### 5a. Switch it on and pick the bot user (do this first)

In a new world the add-on starts **disabled with no bot user chosen**. Until you set both, your bot shows **offline** on every player's screen.

1. Tick **Enabled**. It is the master switch: when it is off, no events are sent and every command is refused.
2. In **Bot GM user (preferred leader, runs commands)**, pick the user from step 3.
3. Click **Save**.

Under **Advanced**, **Bot user name prefix** is a fallback. If no bot user is picked, the add-on uses the first Game Master whose name starts with that text. Picking the user from the list is simpler.

### 5b. Connect the bot (delivery and webhook)

**Delivery** decides how events reach your bot.

| Mode | How it works | When to use it |
|---|---|---|
| **relay** (the default, recommended) | A small program from the `relay/` folder of the repository logs into Foundry as the bot user, POSTs batches to your bot and runs any commands the bot answers with. The webhook URL and secret live in the relay's environment, **never inside Foundry**. | Shared worlds, and anywhere you want the secret kept out of Foundry. |
| **direct** | The bot user's own browser POSTs the batches to your webhook. The webhook must allow CORS, and the bot user must stay logged in. | A quick personal setup. |

**Relay.** Configure it with environment variables (see `relay/RUN.md` in the repository; it has a Docker example):

- `AIGM_WEBHOOK_URL`: where your bot listens.
- `AIGM_WEBHOOK_AUTH`: the secret sent in the auth header.
- `AIGM_WEBHOOK_AUTH_HEADER`: optional, defaults to `Authorization`.
- `FOUNDRY_URL`, `FOUNDRY_RELAY_USER`, `FOUNDRY_RELAY_PASSWORD`: how the relay logs in. Use the bot user from step 3.
- `FOUNDRY_EXPECT_WORLD`: optional. The relay refuses any other world.

Run **exactly one relay per world**. In relay mode, leave **Webhook URL** blank in Foundry.

**Direct.** In the settings window:

- **Webhook URL:** the address of your bot's webhook.
- **Webhook secret (direct mode):** type the secret once. The box is **write-only**: it shows "set, leave blank to keep" after saving. Tick **Clear stored secret** to remove it.
- **Webhook auth header** (under **Advanced**): the name of the HTTP header that carries the secret. The default is `Authorization`.

> **Direct mode and a webhook on your own network.** If the webhook URL is on your own network (`localhost`, `127.0.0.1`, or a private home-network address in the usual 10, 172.16 to 172.31 or 192.168 ranges), Chrome can block a web page from reaching it, because browsers protect local-network addresses ("Local Network Access"). The request then never leaves the browser and your bot's log shows nothing, not even a preflight. Test connection tells you when this is the likely cause. Use one of these fixes: a **public https webhook URL**, allow this site's **local-network access** in the browser's site settings (Chrome asks when you click Test connection, if your version supports it), or switch **Delivery** to **relay**. The permission has to be granted in the bot user's browser as well, because that is the browser that sends real events.

> **Direct mode and secrets.** Foundry shares world settings with every logged-in user's browser, so a technical player could read the stored secret. Use the relay for any world with other people in it.

**What your bot receives.** Every request carries these headers:

- `content-type: application/json`
- `<auth header>: <secret>`
- `idempotency-key: <batchId>`

The body has `batchId`, `world`, `seq`, `ctx` and `events`. **Every batch and every event also carries `worldId`, `worldTitle` and `systemId`** (the world's id and title, and the game system's id). One bot or automation can serve several worlds: route and keep state by `worldId`, and use `systemId` to pick the right rules. Full details are in `docs/BOT-API.md`.

A line that addresses the GM (a mention, a whisper, an ability roll) goes out at once as its own batch, so two players speaking in the same second can arrive as two batches. Plain chat can share a batch.

Your bot must answer `2xx` as soon as it has the batch, before any slow work. Until it does, the add-on retries (after 2 s, 5 s, 15 s, then every 60 s) with the same batch, so your bot should handle each `batchId` once.

### 5c. Test connection

Click **Test connection** in the same window. It POSTs `{ "type": "testConnection", "ping": true }` (plus a test id and the world fields) to your webhook, and your bot should answer `2xx`.

**What a pass tells you:**

- **With a webhook URL:** the webhook received the test event and answered `2xx`. That is the same acknowledgement real events need, so it is a genuine round trip from your browser to the bot's endpoint and back. It does **not** prove the bot will wake up and reply. A failure explains itself: an HTTP status, `No answer within N s (timeout)`, or "unreachable or blocked by CORS" (direct mode needs the webhook to allow browser requests). For a localhost or private-address URL it names the browser's local-network protection as the likely cause (see the note above).
- **With no URL (relay mode):** it only checks that the bot user is logged in to Foundry. It does not test the relay's own webhook, which is set outside Foundry.
- In direct mode with an empty URL it tells you the bot will not receive anything.
- It also runs a short link check and adds any setup warnings, such as characters with no player owner or a **Bot not receiving** warning (below).

The test is sent from **your** browser. In direct mode, real events are sent from the **bot user's** browser, so a bot that is not logged in will pass Test connection and still receive nothing. The warning below catches that case.

### 5d. "Bot not receiving" warning

Only Game Masters see this warning. It appears in the add-on panel (the robot button in the sidebar), in **Check setup**, in **Test connection**, and once as a notification when the problem first appears. It clears by itself once the problem is fixed. It appears when the add-on is enabled and:

- no bot user is picked (or the picked user no longer exists), or
- delivery is **direct** and the **Webhook URL** is empty, or
- the last three direct deliveries to the webhook failed, or
- an event was sent and nothing acknowledged it for about two minutes.

What to do: check that your bot's endpoint is reachable and answers `2xx` immediately; in direct mode check that the bot user is logged in; in relay mode check that the relay is running and logged in as the bot user. Events that were not acknowledged are kept and retried, so nothing is lost.

Limit: in relay mode the add-on marks chat events as received when it hands them to the relay, so it cannot see a relay that has stopped forwarding. Watch the status light (step 10) and the relay's own log.

### 5e. HP path (important if you are not playing Pirate Borg)

**HP data path** is under **Advanced**. It tells the add-on where your game system keeps hit points on an actor.

| System | HP path |
|---|---|
| Pirate Borg (the default) | `system.attributes.hp.value` |

For any other system, open a character's data (or ask your bot to read an actor) and find the field that holds current HP. Enter that path.

If it is wrong, HP commands can report success and change nothing.

### 5f. Other settings you may want

| Setting | What it does |
|---|---|
| **Bot names** (Advanced) | Names that count as talking to the GM. The default is `gm, ai gm`. Add your bot's name. |
| **Auto-unpause during play** | On by default. Unpauses after map builds, when a fight starts and when a turn changes. It never unpauses when the world loads. |
| **Send combat start/end** | On by default. Lets the bot stay aware of fights. |
| **Local commands** (Advanced) | Handles chat commands such as `!roll`, `!music`, `!scene`, `!hp` and `!turn` inside Foundry with no bot call. |
| **Always-voice users** | Names of players who always get voiced replies. |

---

## 6. Players: their own users, owned characters, linked tokens

The add-on has to know who is a player and who is a monster. Set this up once per player:

1. **Make each player a Player (or Trusted) user**, not Game Master.
2. **Give that user Owner permission on their character.** Right-click the character in the **Actors** sidebar, choose **Configure Ownership**, and set that user to **Owner**. You can also assign it as the user's character in **User Management**.
3. **Link the token to the character.** Open the character sheet, click **Prototype Token**, and on the **Identity** tab turn on **Link Actor Data**. A linked token and its sheet are one and the same, so HP and loot stay in sync.

Why it matters:

- A character owned **only by a Game Master** (or by nobody) counts as a **monster**, not a player.
- A player character on an **unlinked** token keeps separate copies of HP and items on the token and on the sheet, and they drift apart.

**Check your setup.** Open the add-on panel (the robot button in the sidebar) and click **Check setup**. **Test connection** reports the same. It warns if:

- a player-looking character has no player owner,
- a player's token is not linked to its character, or
- the bot is not receiving (see 5d).

It only warns. It never changes your world.

**Fixing unlinked tokens.** Tokens the add-on places for player characters are linked automatically. For tokens already on a scene, ask your bot to run **`linkPlayerTokens`** with a **dry run** first. The dry run lists what differs between each token and its sheet and changes nothing. It handles one scene at a time and keeps the world sheet's values.

---

## 7. Teach your bot: Copy bot setup prompt

The add-on ships a ready-made prompt that tells your bot how to use it (events, commands, combat flow, safety rules).

1. Open the add-on's section in **Configure Settings** (same place as step 5) and click **Copy bot setup prompt**. This is Game Master only.
2. A window opens with the prompt in a text box and copies it to your clipboard automatically (it shows **Copied.**).
3. If the copy is blocked, click in the box and press **Ctrl+C** (the text is pre-selected), or click **Copy to clipboard**.
4. Paste it into your bot's instructions.
5. A short note at the top of the window lists the steps from this guide and the placeholders to fill in, such as the webhook URL and the bot's user name.

The prompt ends with a **Game rules pack** for Pirate Borg. If you play another system, replace that last section with your system's rules.

---

## 8. Your bot's side (short version)

Your bot should:

1. Receive the batch at its webhook and answer `2xx` right away.
2. Handle each event once (a retry has the same `batchId`).
3. Use `worldId` to tell worlds apart if one bot serves several.
4. Send commands in one of two ways:
   - Return them in the HTTP response: `{ "commands": [{ "name": "...", "args": { } }] }`, up to 20 at once.
   - Call `game.modules.get("ai-gm-bridge").api.run({ name, args })` from the bot user's Foundry browser session.
5. Reply to a chat event with `replyTo` set to that event's id.

`examples/echo-gm.mjs` in the repository is a small working example.

---

## 9. Voice

The add-on **plays** voice. It does not **make** it.

- Your **bot** makes the audio with its own text-to-speech and posts it with the **`postVoice`** command (text plus audio). If the bot only posts text, nobody hears anything.
- The add-on's voice list uses these names. Ask your bot to use the same voices so cached clips match: **Ryan** (British man, the default), **Thomas** (British man), **Sonia** (British woman), **Aria** (American woman).
- Each player picks their own voice in their own settings. If a clip for their voice is missing, it falls back to Ryan, then to text.

**Settings each person sets for themselves (this browser only):**

| Setting | What it does |
|---|---|
| **Spoken voice** | Which GM voice you hear. **Play sample** previews it. |
| **GM voice volume** | 0 to 100%, separate from Foundry's music volume. |
| **Big captions** and **Caption font** | A large caption of the line being spoken. |
| **Hear ally and enemy turns** | A short "<name> is up" clip on ally and enemy turns. |
| **Push-to-talk** and **Push-to-talk key** | Hold a key or the on-screen logo button to speak. Your words are posted as chat. Chrome or Edge only, and the page must be HTTPS or localhost. |

If your browser blocks sound, an **Enable sound** button appears. Click it (any click or key press also unlocks audio).

---

## 10. Your first test

1. Make sure your bot (and the relay, if you use one) is running and logged in to Foundry as the bot user.
2. Log in as yourself in a separate browser window or profile.
3. Look at the small **status light** at the bottom right of the screen. You want **GM listening**.
   - **AI GM offline** or **AI GM reconnecting** means the link is down. See [Troubleshooting](#troubleshooting).
   - **GM paused** means the AI is paused. Use the sidebar panel to resume.
4. Click **Test connection** (step 5c) and **Check setup** and fix any warnings.
5. Type in chat, for example: **`Hi GM, are you there?`** The bot names setting and a question both wake it.
6. Watch the light change: **GM waking up → GM reading → GM thinking… → GM speaking**. A reply should appear in chat.
7. Ask for something voiced: **`GM, say something to the table.`** You should hear the line. Each voiced line has a **▶** replay button.

If all that works, you are ready to play.

---

## Troubleshooting

**The status light says "AI GM offline".**
The most common cause in a new world is that the add-on is not switched on or no bot user is picked. Open **Configure AI GM Pirate Borg**, tick **Enabled**, pick the bot user and **Save** (step 5a). Then check that:
- your bot or relay is running and logged in as that user,
- it is the Game Master user you picked,
- **Test connection** passes.

**"Bot not receiving" appears.**
See step 5d. The usual causes are an empty webhook URL in direct mode, a bot endpoint that is down or slow to answer, or a bot user that is not logged in.

**The bot never reacts to chat in a new world.**
Each world needs its own connection. In relay mode run one relay per world. In direct mode enter the webhook URL in that world's settings. Several worlds can share one bot endpoint: events carry `worldId`.

**The map is grey (Foundry v14).**
In v14 a scene's background lives on the scene's **level**, not on the scene itself. A background written the old way saves as empty and the scene stays grey. The add-on's own map commands (`setBackground`, and `createScene` with `src`) write the level's background on v14 and the scene's on older versions. If your bot sets backgrounds some other way, it has to write the level (for the first level, `scene.levels.defaultLevel0000.background.src`). To fix a scene by hand, open its **Scene Configuration**, go to the **Levels** tab, select the level and set its **Background Image**.

**No voice.**
The bot has to post **voiced** lines (`postVoice` with audio). Plain text makes no sound. Also check:
- the **Enable sound** button (the browser blocked audio),
- that your **GM voice volume** is not 0,
- that the bot is generating and uploading audio (the add-on never calls a speech service itself).

**The game stays paused.**
- Click **Start game** in the add-on's panel, or type `start` in chat (the **Unpause on 'start'** setting is on by default).
- **Auto-unpause during play** only unpauses after map builds, when a fight starts and when a turn changes. It never unpauses when the world loads. If you turned it off, unpause yourself.
- "GM paused" on the status light means the **AI** is paused, not the game.

**The bot answers the same message twice, or not at all.**
Make sure only one relay or one bot session handles the world, and that your bot passes `replyTo` on every reply.

**HP changes do nothing.**
Set the **HP data path** for your system (step 5e).

**Pirate Borg system errors in the console.**
The Pirate Borg game system itself can log class-item errors when an owned actor is created while a player who is not that actor's owner is online. This is a known issue on the system's side. The add-on is not involved and it does not affect play.

**A player's character is treated like a monster.**
Give that character a Player owner (step 6). Characters owned only by Game Master users count as monsters.

**HP or loot on a player differs between the token and the sheet.**
The token is unlinked. Link it (step 6), or ask your bot to run `linkPlayerTokens` (dry run first).

<a id="pirate-borg-only"></a>
**These commands are Pirate Borg only for now.**
Outside Pirate Borg they return an error or do nothing useful:
- **Morale** (`moraleCheck` and the automatic morale cards): "needs the pirateborg system".
- **Ships** (`startShipCombat`, `shipAction`, `shipDamage`, `getShip`).
- **`rest`**: "rest needs the pirateborg system".
- **Devil's Luck** (`spendLuck` and `!spendluck`).
- **`testFight`** builds its test enemy from Pirate Borg creatures and may fail in other systems.

Chat, voice lines, `setHP` (with the right HP path), `setupCheck` and scene building have been tried in another system. Other commands (loot, `linkPlayerTokens`, `requestRoll`, pets) have not been tested outside Pirate Borg. **Support for more game systems is planned for the 1.0 release.**

---

## Safe habits

- Never paste your bot's password or webhook secret into chat or a journal.
- Do not give players the bot's login.
- Keep GM-only notes in journals your bot is told about by name. Foundry sends GM-only journals to every player's browser, so a determined player can read them from the console. Do not rely on them to hide big spoilers.

## Credits and links

- Created by **Gate (GateShark)**.
- Repository, releases and bug reports: https://github.com/GateShark/ai-gm-bridge
- In the repository: `README.md`, `docs/BOT-API.md` (full payload and command reference), `relay/RUN.md` (relay setup), `examples/echo-gm.mjs`.
- This is a beta. Please report bugs on the repository's issues page.
