# Companion

The `companion` module is a Discord bot for one person. It chats with you by direct message
and talks with you in a voice channel, about what you are into. It remembers what it learns
about you, and it is quiet the moment you say so. It thinks with the language model on your
own machine (the `ai` module); when that machine is off, it can ask Claude instead.

It answers one Discord account and nobody else. It opens no port: it only connects out.

**Status: experimental.** What has been tried and what has not is at the
[end of this page](#what-is-tested).

## What leaves your house

Discord is an outside service, and the companion talks to you through it.

- **Direct messages.** What you write and what it answers is stored by Discord, like every
  direct message.
- **Voice.** Discord encrypts voice channels from end to end (it calls this DAVE), so the
  sound goes encrypted from your device to the companion. Discord learns who was in the
  channel and when, not what was said.
- **Its address.** Discord sees the Internet address of the machine the companion runs on.
- **Stays at home:** the language model, turning your speech into text, turning its answer
  into a voice, and everything it remembers about you.
- **Only if you set it:** your public GitHub repositories are read from GitHub once a day
  (`github_user`). With a brain other than `studio`, the talk goes to that company
  ([What it thinks with](#what-it-thinks-with)); its answer then ends with a line that says so.

## What you set up at Discord

1. Open <https://discord.com/developers/applications?new_application=true>, give the
   application a name and press **Create**.
2. On the page **Bot**, press **Reset Token** and copy the token. It is shown once. Leave the
   three *Privileged Gateway Intents* switched off.
3. On the page **Installation**, tick **Guild Install**, choose **Discord Provided Link**, and
   under *Default Install Settings* give Guild Install the scopes `applications.commands` and
   `bot` with the permissions *View Channels*, *Send Messages*, *Connect*, *Speak* and *Use
   Voice Activity*.
4. Make a Discord server of your own with one voice channel. A bot cannot join a call in
   direct messages, so voice needs a server. Open the install link from step 3 and add the
   bot to that server. The companion leaves every server that does not belong to you.

## Set it up

The token and keys go into the network's secret store, typed without being shown. They are
never written into the fleet file. `papaya` is the machine in these examples.

```bash
kiwi-server secrets set ~/kiwi/fleet.yaml papaya companion.bot_token
kiwi-server secrets set ~/kiwi/fleet.yaml papaya companion.ai_key < ~/kiwi/secrets/ai/papaya.key
```

Then add the module to the machine in the fleet file:

```yaml
papaya:
  node:
    modules: [vpn-client, reverse-proxy, ai, companion]
    companion:
      owner: your_discord_name        # the one account it answers
      github_user: your-github-name   # optional: your public repositories, to talk about
      ai_model: peculiar-ragdoll/Tiel-Coder-35B-A3B-GGUF-MTP
      ai_quant: UD-Q4_K_S
```

`owner` is your Discord user name or user id. With a name, the companion keeps the account's
id at your first message and goes by the id from then on.

On a machine without the `ai` module, set `ai_url` to the machine that has it
(`https://ai.papaya.home`).

| Setting | Default | Meaning |
|---|---|---|
| `brains` | `[studio]` | What it thinks with, in this order. See [What it thinks with](#what-it-thinks-with). |
| `languages` | `[en, de]` | The languages you use with it. The first is assumed when a sentence could be either. |
| `listen` | `conversation` | When it answers in a voice channel. See [Talk to it aloud](#talk-to-it-aloud). |
| `checkin` | `off` | A time window such as `18:00-22:00`: it writes first, once a day in that window, if you have not written that day. |
| `name`, `voice` | empty | Empty: it names itself and picks a voice at its first start. The voices are listed under [Talk to it aloud](#talk-to-it-aloud). |
| `voice_de` | empty | The voice for German sentences when its own voice speaks English only. |
| `ai_load` | `true` | It may load the model when Studio has none loaded. It never replaces a loaded model. |
| `pause` | `1200` | Milliseconds of silence after which what you said counts as finished. |

## Write with it

Open a direct message with the bot (click it in your server's member list) and write. These
commands work in the direct message and in the server:

| Command | What it does |
|---|---|
| `/quiet [minutes]` | It stops talking at once. Without minutes it stays quiet until you say its name or type `/talk`. Quiet also holds back the messages it would write first. |
| `/talk` | It talks again. |
| `/off`, `/on` | Switched off, it answers nothing and uses no model, so the local AI is free for other work. |
| `/status` | Its name, what it thinks with, whether it is quiet, its settings. |
| `/memory` | Everything it knows about you, numbered. |
| `/remember text` | Something it should keep. |
| `/forget N`, `/forget all` | Removes one note, or everything: the notes, the summary and the talk so far. |
| `/interest text` | Something you are into, to talk about. |
| `/join`, `/leave` | It comes into the voice channel you are in, or leaves it. |
| `/set setting value` | Changes `listen`, `checkin`, `load`, `pause`, `name`, `voice` or `german` (its German voice) while it runs. |

Writing "be quiet", "shut up", "Ruhe" or "sei still" as a whole message does the same as
`/quiet`.

## Talk to it aloud

Join the voice channel of your server and type `/join`. The first time, it fetches what it
needs to hear and to speak (about 900 MB, checked against known checksums) into its own volume.

- **It stops when you speak.** Its voice pauses the moment your microphone sends sound. If
  that was only a noise, it goes on. If you said something to it, what it was saying is
  dropped.
- **"Be quiet"** (or "quiet", "shut up", "Ruhe", "sei still", "psst") keeps it silent until
  you say its name. "Stop" ends only what it is saying now. Discord's own *Mute* on the bot
  always works too.
- **When it answers** is the setting `listen`. `conversation`: say its name to start, then
  talk; it stays in the talk until 45 seconds pass in silence. `name`: it answers only when
  you say its name. `always`: it answers everything it hears, which suits a quiet room.

To find its name, it turns everything you say in the channel into text, on the machine.
What is not meant for it is dropped and not kept.

- **It lets you finish.** When you stop, it waits for `pause` milliseconds of silence. If your
  sentence sounds unfinished ("so I was thinking that"), it waits that long once more. If you
  go on in that time, both parts count as one turn.

Hearing and speaking run on the machine's processor, not on the graphics card, so they fit
beside a model that fills the card. Hearing uses Parakeet TDT 0.6B v3, which knows English
and German.

| Voices | Speak | What they are |
|---|---|---|
| `heart`, `bella`, `nicole`, `sky`, `emma`, `michael`, `fenrir`, `puck`, `george`, `fable` | English | Kokoro. The most natural ones; it picks one of these by itself. |
| `bria`, `loona` | English | Pocket TTS. |
| `kitten1` to `kitten8` | English | Kitten. |
| `ryan` | English | Piper. Plain, and the quickest. |
| `thorsten` | German | Piper. |
| `f1` to `f5`, `m1` to `m5` | English and German | Supertonic. |

A voice that speaks English only hands German sentences to `voice_de`, or to a German voice
that fits it. `/set voice george` changes the voice while it runs, and it says a line so you
hear it. Kokoro, Kitten and Piper take their pronunciation from espeak-ng through
`piper-phonemize-node`, which is under the GPL, version 3 or later.

**Known gaps.** Technical words are often misheard ("Btrfs" became "BTAPs" in the tests).
The model is told to guess from what it knows, which does not always work. If your
microphone picks up the game's sound, use `name` or push-to-talk.

## What it remembers

Everything is in the volume `companion_data` on the machine, as plain files:

- `notes.md`: what it knows about you, one fact per line. It adds a line when you tell it
  something worth keeping, and you can edit the file. `/memory` shows it.
- `chat.jsonl`: the talk so far. The last 40 entries go to the model with every answer.
- `summary.md`: a few sentences on what you talked about lately.
- `persona.json`: its name, voice and manner. Delete it to have it choose again.

The volume is part of the machine's backup. The speech models are in a second volume that is
not backed up, because they can be fetched again.

Nothing about you is written in the module or in the fleet file. What it should know about
you, you tell it.

## What it thinks with

`brains` lists who answers, in order. The first that can answer does.

| Brain | What it is | What it needs |
|---|---|---|
| `studio` | The model of the `ai` module, at home. | `ai_key`. Nothing leaves the house. |
| `claude-code` | Claude, asked through the Claude Code program with your own Claude login. | `claude_token`, made by `claude setup-token`. |
| `anthropic` | Claude, with an API key. Paid per use. | `anthropic_key` |
| `openai` | Any service with OpenAI's API. Paid per use. | `openai_key`, `openai_model` |

`brains: [studio, claude-code]` answers from home while that machine is on and asks Claude
while it is off.

**About `claude-code`.** The companion starts the unmodified `claude` program for each
answer, without tools and in an empty folder, and hands it your login token; it never uses
the token itself. Anthropic's terms allow you to sign in to Claude Code with your own
subscription, and they name an API key as the way for programs that others use. They do not
say clearly whether a private bot like this one counts as ordinary use of Claude Code. Use it
for your own messages only, and prefer `anthropic` with an API key if you want to be on the
safe side. Claude Code adds the system's name, its kernel version and the date to what it
sends.

Hearing and speaking do not depend on the brain: they work with every one of them.

## What is tested

- Tested: the program's own tests; the module renders for a machine; the image starts
  read-only without privileges.
- Tested against the real model at home, in a terminal: answers in English and German, notes,
  the summary, GitHub interests, quiet, a message written first, the `claude-code` brain.
- Tested without Discord: the whole voice chain on recorded clips.
- Not tested: the `anthropic` and `openai` brains with a real key.
