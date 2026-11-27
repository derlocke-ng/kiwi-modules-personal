// The voice channel: it hears its one person, answers aloud, and stops the moment he speaks.
//
//   he speaks ──> (silence of `pause` ms ends his sentence) ──> speech to text ──> the brain
//   answers in pieces ──> each finished sentence becomes sound ──> played, one after another
//
// While he speaks its voice is paused at once; when that was only a noise, it goes on, and
// when he said something, what it was saying is dropped. "Be quiet" keeps it silent.
import { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, EndBehaviorType, StreamType, VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior } from '@discordjs/voice';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { Speech, Sentences, toPcm, fromPcm } from './speech.js';
import { ensure } from './models.js';
import { called } from './quiet.js';

const OpusScript = createRequire(import.meta.url)('opusscript');
const ATTENTIVE_MS = 45 * 1000;          // "conversation": after it spoke, he can go on without its name this long
const MAX_UTTERANCE_S = 60;

export async function makeVoice({ cfg, store, companion, say, presence }) {
  const speech = new Speech({ dir: cfg.speech.dir, threads: cfg.speech.threads });
  let connection = null, player = null, channelId = null, ownerId = null;
  let queue = [], playing = false, pausedByHim = false, answer = null, attentiveUntil = 0, capturing = false;

  const pauseMs = () => store.state.pause || cfg.speech.endSilenceMs;
  const mode = () => companion.setting('listen');

  function playNext() {
    if (playing || !queue.length || !player) return;
    playing = true;
    const pcm = queue.shift();
    player.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw }));
  }

  function hush() {                                     // stop talking now, and drop what was still to come
    answer?.abort.abort();
    answer = null;
    queue = [];
    pausedByHim = false;
    player?.stop(true);
    playing = false;
  }

  async function speakText(text, my) {                  // one sentence into the queue, unless it was cut off meanwhile
    const t = Date.now();
    const a = await speech.speak(text, companion.persona.voice, cfg.languages);
    if (my && my !== answer) return;
    my?.timing && (my.timing.tts ||= Date.now() - t);
    queue.push(toPcm(a.samples));
    if (my?.timing && !my.timing.firstSound) my.timing.firstSound = Date.now();
    if (!pausedByHim) playNext();
  }

  async function heard(samples, spokenMs, endedAt) {
    const t0 = Date.now();
    let text = '';
    try { text = await speech.hear(samples, 48000); } catch (e) { say('hearing failed:', e.message); }
    const sttMs = Date.now() - t0;
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!text || (spokenMs < 350 && words < 2)) {       // a cough, a key, the game: go on where it was
      if (pausedByHim) { pausedByHim = false; player.unpause(); playNext(); }
      return;
    }
    if (companion.off) return;
    const cmd = companion.plainCommand(text);
    if (cmd === 'quiet' || cmd === 'stop') { hush(); if (cmd === 'quiet') attentiveUntil = 0; presence(); say(`voice: "${text}" -> ${cmd}`); return; }
    if (cmd === 'called') presence();
    if (companion.quiet.on) { hush(); return; }
    const byName = cmd === 'called' || called(text, companion.names());
    const forMe = mode() === 'always' || byName || (mode() === 'conversation' && Date.now() < attentiveUntil);
    if (!forMe) {                                       // not meant for it: what it was saying goes on
      if (pausedByHim) { pausedByHim = false; player.unpause(); playNext(); }
      return;
    }
    hush();                                             // he said something to it: the old answer is over
    const my = answer = { abort: new AbortController(), timing: { ended: endedAt, stt: sttMs } };
    attentiveUntil = Date.now() + ATTENTIVE_MS;
    const cut = new Sentences();
    let chain = Promise.resolve(), firstWord = 0;
    try {
      for await (const piece of companion.reply(text, { via: 'voice', signal: my.abort.signal })) {
        if (my !== answer) break;
        firstWord ||= Date.now();
        for (const s of cut.feed(piece)) chain = chain.then(() => speakText(s, my)).catch((e) => say('speaking failed:', e.message));
      }
      if (my === answer) for (const s of cut.rest()) chain = chain.then(() => speakText(s, my)).catch((e) => say('speaking failed:', e.message));
      await chain;
    } catch (e) {
      if (!my.abort.signal.aborted) say('voice answer failed:', String(e.message).slice(0, 200));
    }
    const tm = my.timing;
    if (tm.firstSound) say(`voice: heard in ${tm.stt} ms, first word after ${firstWord - endedAt - tm.stt} ms more, first sound ${tm.firstSound - endedAt} ms after he stopped (plus the ${pauseMs()} ms of silence that ended his sentence)`);
  }

  function listen() {
    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (userId !== ownerId || capturing) return;
      capturing = true;
      if (playing || queue.length) { pausedByHim = true; player.pause(true); }       // at once, before knowing what he says
      const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
      const parts = [];
      let bytes = 0;
      const started = Date.now();
      const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: pauseMs() } });
      stream.on('data', (packet) => {
        if (bytes > MAX_UTTERANCE_S * 48000 * 4) return;
        try { const pcm = Buffer.from(decoder.decode(packet)); parts.push(pcm); bytes += pcm.length; } catch { /* a broken packet */ }
      });
      const done = () => {
        if (!capturing) return;
        capturing = false;
        try { decoder.delete(); } catch { /* gone */ }
        const endedAt = Date.now() - pauseMs();         // when he stopped, not when the silence was over
        const spokenMs = bytes / (48000 * 4) * 1000;
        if (bytes) heard(fromPcm(Buffer.concat(parts)), spokenMs, endedAt).catch((e) => say('voice:', e.message));
        else if (pausedByHim) { pausedByHim = false; player.unpause(); playNext(); }
      };
      stream.once('end', done); stream.once('close', done); stream.once('error', done);
    });
  }

  return {
    get channelId() { return channelId; },
    hush,
    settingsChanged() {},
    leave() {
      hush();
      try { connection?.destroy(); } catch { /* already gone */ }
      connection = null; channelId = null;
    },
    async join(channel, userId) {
      await ensure(speech.dir, ['hear', 'speak'], say);
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
