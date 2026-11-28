// The voice channel: it hears its one person, answers aloud, and stops the moment he speaks.
//
//   he speaks ──> silence of `pause` ms ends that stretch ──> speech to text
//     ──> it waits a little more (longer when the sentence sounds unfinished); if he goes on,
//         the stretches become one turn
//     ──> the brain answers in pieces ──> each finished sentence becomes sound ──> played
//
// While he speaks its voice is paused at once; when that was only a noise, it goes on, and
// when he said something, what it was saying is dropped. "Be quiet" keeps it silent.
import { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, EndBehaviorType, StreamType, VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior } from '@discordjs/voice';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { Speech, Sentences, toPcm, fromPcm } from './speech.js';
import { ensure, needed } from './models.js';
import { called, command } from './quiet.js';
import { language } from './voices.js';

const OpusScript = createRequire(import.meta.url)('opusscript');
const ATTENTIVE_MS = 45 * 1000;          // "conversation": after it spoke, he can go on without its name this long
const MAX_UTTERANCE_S = 60;
const GRACE_MS = 250;                    // after a sentence that sounds finished: a last moment for him to go on
const UNFINISHED = /(\b(and|but|or|so|because|if|when|that|the|a|to|of|with|like|um+|uh+|er+|well|und|aber|oder|weil|wenn|dass|also|äh+|ähm+|so)|[,;:–-])$/i;

// Does what he said sound like a whole sentence? (Speech recognition writes the full stop.)
export function finished(text) {
  const t = String(text || '').trim();
  return /[.!?…]["')\]]?$/.test(t) && !UNFINISHED.test(t.replace(/[.!?…"')\]]+$/, ''));
}

export async function makeVoice({ cfg, store, companion, say, presence }) {
  const speech = new Speech({ dir: cfg.speech.dir, threads: cfg.speech.threads });
  let connection = null, player = null, channelId = null, ownerId = null;
  let queue = [], playing = false, pausedByHim = false, answer = null, attentiveUntil = 0, capturing = false;
  let held = null;                                      // {text, endedAt, timer}: heard, and waiting to see whether he goes on

  const pauseMs = () => store.state.pause || cfg.speech.endSilenceMs;
  const mode = () => companion.setting('listen');
  const german = () => store.state.voiceDe || cfg.voiceDe || '';
  const models = () => ensure(speech.dir, needed(companion.persona.voice, cfg.languages, german()), say);

  function playNext() {
    if (playing || !queue.length || !player) return;
    playing = true;
    player.play(createAudioResource(Readable.from([queue.shift()]), { inputType: StreamType.Raw }));
  }
  const resume = () => { if (pausedByHim) { pausedByHim = false; player.unpause(); playNext(); } };

  function hush() {                                     // stop talking now, and drop what was still to come
    answer?.abort.abort();
    answer = null;
    queue = [];
    pausedByHim = false;
    player?.stop(true);
    playing = false;
  }

  async function speakText(text, my) {                  // one sentence into the queue, unless it was cut off meanwhile
    const a = await speech.speak(text, companion.persona.voice, cfg.languages, german());
    if ((my && my !== answer) || !a.samples.length) return;
    queue.push(toPcm(a.samples));
    if (my?.timing && !my.timing.firstSound) my.timing.firstSound = Date.now();
    if (!pausedByHim) playNext();
  }

  async function respond(text, endedAt) {
    hush();                                             // he said something to it: the old answer is over
    const my = answer = { abort: new AbortController(), timing: { started: Date.now() } };
    attentiveUntil = Date.now() + ATTENTIVE_MS;
    const cut = new Sentences();
    let chain = Promise.resolve();
    const speak = (s) => { chain = chain.then(() => speakText(s, my)).catch((e) => say('speaking failed:', e.message)); };
    try {
      // a search takes seconds: if it has said nothing yet, it says that it is looking
      const onTool = () => { if (!my.timing.firstWord && !my.filler && my === answer) { my.filler = true; speak(language(text, cfg.languages[0]) === 'de' ? 'Moment, ich schau nach.' : 'Let me look that up.'); } };
      for await (const piece of companion.reply(text, { via: 'voice', signal: my.abort.signal, onTool })) {
        if (my !== answer) break;
        my.timing.firstWord ||= Date.now();
        cut.feed(piece).forEach(speak);
      }
      if (my === answer) cut.rest().forEach(speak);
      await chain;
    } catch (e) {
      if (!my.abort.signal.aborted) say('voice answer failed:', String(e.message).slice(0, 200));
    }
    const tm = my.timing;
    if (tm.firstSound) say(`voice: waited ${tm.started - endedAt} ms for him to finish, first word ${tm.firstWord - tm.started} ms later, first sound ${tm.firstSound - endedAt} ms after he stopped`);
  }

  async function heard(samples, spokenMs, endedAt) {
    let text = '';
    try { text = await speech.hear(samples, 48000); } catch (e) { say('hearing failed:', e.message); }
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!text || (spokenMs < 350 && words < 2)) return resume();          // a cough, a key, the game: go on where it was
    if (companion.off) return;
    const cmd = command(text) ? companion.plainCommand(text) : null;      // "be quiet", "stop": only as a stretch of its own
    if (cmd === 'quiet' || cmd === 'stop') {
      clearTimeout(held?.timer); held = null;
      hush();
      if (cmd === 'quiet') attentiveUntil = 0;
      presence();
      say(`voice: he said ${cmd}`);
      return;
    }
    const all = held ? `${held.text} ${text}` : text;                     // he went on: one turn
    clearTimeout(held?.timer); held = null;
    if (companion.quiet.on) {
      if (!called(all, companion.names())) { hush(); return; }
      companion.quiet.end(); presence();
    }
    const forMe = mode() === 'always' || called(all, companion.names()) || (mode() === 'conversation' && Date.now() < attentiveUntil);
    if (!forMe) return resume();                                          // not meant for it: what it was saying goes on
    if (playing || queue.length || answer) hush();                        // it was talking and he spoke to it: over
    held = { text: all, endedAt };
    arm(finished(all) ? GRACE_MS : Math.max(GRACE_MS, pauseMs()));       // a sentence that sounds unfinished gets more time
  }

  // what was heard is answered after `wait` ms, unless he speaks again first
  function arm(wait) {
    if (!held) return;
    clearTimeout(held.timer);
    held.armed = true;
    held.timer = setTimeout(() => {
      const h = held;
      if (!h || capturing) return;
      held = null;
      respond(h.text, h.endedAt).catch((e) => say('voice:', e.message));
    }, wait);
  }

  function listen() {
    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (userId !== ownerId || capturing) return;
      capturing = true;
      if (held) { clearTimeout(held.timer); held.armed = false; }         // he goes on: wait for the rest
      if (playing || queue.length) { pausedByHim = true; player.pause(true); }       // at once, before knowing what he says
      const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
      const parts = [];
      let bytes = 0;
      const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: pauseMs() } });
      stream.on('data', (packet) => {
        if (bytes > MAX_UTTERANCE_S * 48000 * 4) return;
        try { const pcm = Buffer.from(decoder.decode(packet)); parts.push(pcm); bytes += pcm.length; } catch { /* a broken packet */ }
      });
      const done = () => {
        if (!capturing) return;
        capturing = false;
        try { decoder.delete(); } catch { /* gone */ }
        const endedAt = Date.now() - pauseMs();                           // when he stopped, not when the silence was over
        const spokenMs = bytes / (48000 * 4) * 1000;
        const next = bytes ? heard(fromPcm(Buffer.concat(parts)), spokenMs, endedAt) : Promise.resolve(resume());
        // nothing new came of it (a noise): what was heard before is still to be answered
        next.catch((e) => say('voice:', e.message)).finally(() => { if (held && !held.armed && !capturing) arm(GRACE_MS); });
      };
      stream.once('end', done); stream.once('close', done); stream.once('error', done);
    });
  }

  return {
    get channelId() { return channelId; },
    hush,
    async settingsChanged(what) {                                         // a new voice: fetch what it needs, and let him hear it
      if (!connection || !(what?.voice || what?.voiceDe)) return;
      await models();
      if (!companion.quiet.on) await speakText(cfg.languages[0] === 'de' ? 'So klinge ich jetzt.' : 'This is how I sound now.');
    },
    leave() {
      clearTimeout(held?.timer); held = null;
      hush();
      try { connection?.destroy(); } catch { /* already gone */ }
      connection = null; channelId = null;
    },
    async join(channel, userId) {
      await models();
      await speech.init();
      this.leave();
      ownerId = userId;
      connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
      try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); } catch (e) { this.leave(); throw new Error('I could not get into the voice channel (may I connect and speak there?)'); }
      channelId = channel.id;
      player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      player.on(AudioPlayerStatus.Idle, () => { playing = false; if (!queue.length && answer) attentiveUntil = Date.now() + ATTENTIVE_MS; playNext(); });
      player.on('error', (e) => { say('player:', e.message); playing = false; playNext(); });
      connection.subscribe(player);
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try { await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]); } catch { this.leave(); }
      });
      listen();
      attentiveUntil = Date.now() + ATTENTIVE_MS;       // he asked it in: he can just start talking
      if (!companion.quiet.on) speakText(cfg.languages[0] === 'de' ? 'Bin da.' : "I'm here.").catch(() => {});
      const how = { conversation: `say my name (${companion.persona.name}) to start; then just talk`, name: `I answer when you say my name (${companion.persona.name})`, always: 'I answer whatever you say' }[mode()];
      return `I am in ${channel.name}. ${how}. "Be quiet" stops me.` + (companion.quiet.on ? ' I am quiet right now: say my name or /talk.' : '');
    },
  };
}
